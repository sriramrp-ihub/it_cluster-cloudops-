/**
 * ADR-0007 Phase C1b: live progress polling for a swarm worker/verifier/
 * synthesizer's (or the adaptive tier's) single `runHermesOneshotForProfile()`/
 * `executeHermesInference()` call.
 *
 * The problem this solves: each of those calls is one opaque
 * `hermes -p <profile> -z "<prompt>" --ignore-rules` oneshot subprocess,
 * given up to `swarmStageTimeoutMs` to finish. A worker that legitimately
 * explores several tools before answering can take most of that budget, and
 * until this feature existed the operator saw a static "Running" card with
 * zero visibility the entire time. Every tool call that profile's own Hermes
 * tool-calling loop makes is already recorded into `tool_executions` by
 * `CloudOpsMcpServer` the instant it happens (see `listToolExecutionsForRun`
 * in `swarmRunTrace.ts`) — well before the oneshot's final JSON response
 * comes back — so polling that table for NEW rows tied to the stage's own
 * child run id gives genuine mid-flight visibility without adding any new
 * execution path (every tool call still goes through the exact same
 * `CloudOpsMcpServer`/`PolicyEngine.evaluate()` choke point).
 *
 * Deliberately extracted into its own tiny, dependency-injected module
 * (rather than inlined into `HermesAgentAdapter`) so the polling/dedup logic
 * itself — seed-then-diff, stop cleanly, fail soft — can be unit-tested in
 * isolation, without mocking `child_process`/the Kysely database at all. See
 * `tests/unit/swarm_progress_poller.test.ts`.
 */

export interface SwarmProgressRow {
  id: string;
  toolName: string;
  status: string;
}

export interface SwarmProgressPollHandle {
  /**
   * Stops polling immediately. Idempotent, and safe to call even if a fetch
   * is already in flight — that in-flight fetch's result is discarded rather
   * than emitted. Callers MUST call this exactly once, in a `finally` block
   * around the oneshot call being observed, so there is never a dangling
   * `setInterval` once that call resolves (success, timeout, or any other
   * failure).
   */
  stop: () => void;
}

export interface StartSwarmProgressPollingParams {
  /**
   * The stage's own child run id (from `createSwarmChildRun`) or, for the
   * adaptive tier, the outer investigation's own run id. `null`/`undefined`
   * (e.g. `createSwarmChildRun` failed soft and returned `null`, or the
   * adaptive tier was never given a `runId`) means "nothing to poll" — this
   * function is then a clean no-op, never a thrown error.
   */
  runId: string | null | undefined;
  /** Poll cadence. This is a live UX feature, not a tight loop — 2-3s is the intended range. */
  intervalMs: number;
  /** Reads every `tool_executions` row persisted so far for `runId`. */
  fetchRows: (runId: string) => Promise<SwarmProgressRow[]>;
  /** Called once per genuinely NEW row seen after polling started. */
  onNewRow: (row: SwarmProgressRow) => void;
  /** Called if `fetchRows` rejects — polling continues on the next tick regardless (fail soft). */
  onError?: ((err: unknown) => void) | undefined;
}

/**
 * Starts polling `fetchRows(runId)` on an interval. The FIRST successful
 * fetch only seeds `seen` with whatever rows already exist (e.g. this run id
 * had unrelated tool_executions before this particular oneshot call started)
 * — those are never reported as "new" progress. Every row seen on a
 * SUBSEQUENT fetch that wasn't already seen is genuinely new mid-flight
 * activity and is reported via `onNewRow`, in the order returned.
 */
export function startSwarmProgressPolling(params: StartSwarmProgressPollingParams): SwarmProgressPollHandle {
  const { runId, intervalMs, fetchRows, onNewRow, onError } = params;

  if (!runId) {
    return { stop: () => {} };
  }

  const seen = new Set<string>();
  let seeded = false;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    let rows: SwarmProgressRow[];
    try {
      rows = await fetchRows(runId);
    } catch (err) {
      onError?.(err);
      return;
    }
    if (stopped) return; // stop() may have raced this in-flight fetch — discard its result.

    if (!seeded) {
      for (const row of rows) seen.add(row.id);
      seeded = true;
      return;
    }

    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (stopped) return;
      onNewRow(row);
    }
  };

  // Fire once immediately so seeding happens right away rather than waiting
  // a full interval before the first (seed-only) observation.
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}
