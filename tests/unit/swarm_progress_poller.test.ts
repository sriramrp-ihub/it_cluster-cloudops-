import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startSwarmProgressPolling, type SwarmProgressRow } from "@cloudops/runtime";

/**
 * ADR-0007 Phase C1b live-progress feature: unit tests for the standalone
 * polling/dedup loop `startSwarmProgressPolling()` extracted into
 * packages/runtime/src/swarmProgressPoller.ts specifically so this logic
 * (seed-then-diff, stop cleanly, fail soft) could be tested in isolation,
 * without mocking `child_process` or the Kysely database the way
 * hermes_swarm_investigation.test.ts has to for the rest of the swarm tier.
 *
 * This repo has no prior fake-timer convention (checked: no other test under
 * tests/unit uses vi.useFakeTimers()) — used here anyway, scoped tightly to
 * this one small, dependency-injected unit, because it's what makes a
 * polling-interval feature's tests fast and deterministic instead of relying
 * on real sleeps with generous margins.
 */

function row(id: string, toolName: string, status = "SUCCESS"): SwarmProgressRow {
  return { id, toolName, status };
}

describe("startSwarmProgressPolling (ADR-0007 Phase C1b live progress)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a clean no-op when runId is null or undefined — never calls fetchRows, stop() is safe", async () => {
    const fetchRows = vi.fn().mockResolvedValue([]);
    const onNewRow = vi.fn();

    const handleNull = startSwarmProgressPolling({ runId: null, intervalMs: 1000, fetchRows, onNewRow });
    const handleUndefined = startSwarmProgressPolling({ runId: undefined, intervalMs: 1000, fetchRows, onNewRow });

    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchRows).not.toHaveBeenCalled();
    expect(onNewRow).not.toHaveBeenCalled();
    expect(() => handleNull.stop()).not.toThrow();
    expect(() => handleUndefined.stop()).not.toThrow();
  });

  it("seeds whatever rows already exist on the very first fetch without ever reporting them as new progress", async () => {
    const fetchRows = vi.fn().mockResolvedValue([row("te_1", "aws_ecs_describe_services"), row("te_2", "aws_ecs_list_clusters")]);
    const onNewRow = vi.fn();

    const handle = startSwarmProgressPolling({ runId: "run_child_1", intervalMs: 1000, fetchRows, onNewRow });

    // Flush the immediate seed tick (fired synchronously inside the function,
    // before the interval timer even exists).
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(onNewRow).not.toHaveBeenCalled();

    // Same two rows again on the next real tick — still not "new".
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewRow).not.toHaveBeenCalled();

    handle.stop();
  });

  it("emits onNewRow, in order, for rows that appear on a tick AFTER the initial seed — the actual mid-flight progress signal", async () => {
    let currentRows: SwarmProgressRow[] = [];
    const fetchRows = vi.fn(async () => currentRows);
    const onNewRow = vi.fn();

    const handle = startSwarmProgressPolling({ runId: "run_child_2", intervalMs: 1000, fetchRows, onNewRow });

    // Seed tick: nothing has been called yet.
    await vi.advanceTimersByTimeAsync(0);
    expect(onNewRow).not.toHaveBeenCalled();

    // The worker's oneshot call is still in flight and has now called one
    // real tool — simulates CloudOpsMcpServer persisting the row mid-flight.
    currentRows = [row("te_10", "aws_ecs_describe_services")];
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewRow).toHaveBeenCalledTimes(1);
    expect(onNewRow).toHaveBeenCalledWith(row("te_10", "aws_ecs_describe_services"));

    // A second tool call appears before the oneshot has resolved.
    currentRows = [row("te_10", "aws_ecs_describe_services"), row("te_11", "aws_cloudwatch_get_metric_data")];
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewRow).toHaveBeenCalledTimes(2);
    expect(onNewRow).toHaveBeenLastCalledWith(row("te_11", "aws_cloudwatch_get_metric_data"));

    // No new rows this tick — no spurious re-emission of already-seen ones.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewRow).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it("stops cleanly: stop() clears the interval so fetchRows is never called again, even once further rows appear", async () => {
    let currentRows: SwarmProgressRow[] = [];
    const fetchRows = vi.fn(async () => currentRows);
    const onNewRow = vi.fn();

    const handle = startSwarmProgressPolling({ runId: "run_child_3", intervalMs: 1000, fetchRows, onNewRow });
    await vi.advanceTimersByTimeAsync(0); // seed

    currentRows = [row("te_20", "aws_ecs_describe_services")];
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewRow).toHaveBeenCalledTimes(1);

    const callsBeforeStop = fetchRows.mock.calls.length;
    handle.stop();

    // The oneshot call this was observing has now resolved — a new tool call
    // arriving afterwards (e.g. a late-arriving DB write) must never surface,
    // and no dangling setInterval should still be firing.
    currentRows = [row("te_20", "aws_ecs_describe_services"), row("te_21", "aws_ecr_describe_images")];
    await vi.advanceTimersByTimeAsync(10000);

    expect(fetchRows.mock.calls.length).toBe(callsBeforeStop);
    expect(onNewRow).toHaveBeenCalledTimes(1);
  });

  it("fails soft: a fetchRows rejection calls onError but never throws, and polling recovers on the next tick", async () => {
    let shouldFail = true;
    const fetchRows = vi.fn(async () => {
      if (shouldFail) throw new Error("db unavailable");
      return [row("te_30", "aws_ecs_describe_services")];
    });
    const onNewRow = vi.fn();
    const onError = vi.fn();

    const handle = startSwarmProgressPolling({ runId: "run_child_4", intervalMs: 1000, fetchRows, onNewRow, onError });

    await vi.advanceTimersByTimeAsync(0); // failing seed tick
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    // DB recovers — since the failed tick never seeded, this next successful
    // fetch becomes the real seed (rows on it are not reported as new).
    shouldFail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewRow).not.toHaveBeenCalled();

    handle.stop();
  });

  it("discards an in-flight fetch's result if stop() is called before it resolves", async () => {
    let resolveFetch: (rows: SwarmProgressRow[]) => void = () => {};
    const fetchRows = vi.fn(
      () =>
        new Promise<SwarmProgressRow[]>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const onNewRow = vi.fn();

    const handle = startSwarmProgressPolling({ runId: "run_child_5", intervalMs: 1000, fetchRows, onNewRow });
    // Seed tick is now in flight (unresolved).
    handle.stop();
    resolveFetch([row("te_40", "aws_ecs_describe_services")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(onNewRow).not.toHaveBeenCalled();
  });
});
