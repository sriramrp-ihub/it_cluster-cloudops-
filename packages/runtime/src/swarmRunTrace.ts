import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import { generateRunId, logger } from "@cloudops/shared";

/**
 * ADR-0007 Phase C1b: per-agent audit trace for swarm sub-stages.
 *
 * Mirrors @cloudops/adapters' RunService.createRun()/completeRun() write
 * shape (same `runs` table, same generated-id scheme) but is a direct,
 * minimal Kysely write rather than importing RunService itself:
 * @cloudops/adapters depends on @cloudops/runtime (see its package.json),
 * so importing RunService here would be a circular package dependency.
 *
 * This intentionally does NOT open its own OTel span the way RunService does
 * — that instrumentation (packages/adapters/src/tracing.ts) is equally
 * unreachable from here without the same circular dependency. This is a
 * real, scoped observability gap for swarm sub-runs specifically (they get a
 * `runs` row, but not their own trace span), not a correctness gap — called
 * out explicitly as a deviation in this feature's own write-up.
 *
 * Fails soft everywhere: a trace-bookkeeping failure must never abort an
 * otherwise-successful swarm investigation stage.
 */
export interface CreateSwarmChildRunParams {
  tenantId: string;
  agentId: string;
  /** The outer investigation's own `runs.id`, if known — see InvestigationDriveContext.runId. */
  parentRunId: string | null;
  userPrompt: string;
}

export async function createSwarmChildRun(
  params: CreateSwarmChildRunParams,
  db: Kysely<DatabaseSchema> = getDatabase()
): Promise<string | null> {
  try {
    const id = generateRunId();
    const traceId = randomBytes(16).toString("hex");
    await db
      .insertInto("runs")
      .values({
        id,
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        session_id: null,
        user_prompt: params.userPrompt,
        status: "RUNNING",
        trace_id: traceId,
        parent_run_id: params.parentRunId,
        created_at: new Date()
      } as any)
      .execute();
    return id;
  } catch (err) {
    logger.warn({ err, params }, "Swarm child run trace-write failed (non-fatal — does not affect the investigation)");
    return null;
  }
}

export interface ToolExecutionProgressRow {
  id: string;
  toolName: string;
  status: string;
  createdAt: Date;
}

/**
 * ADR-0007 Phase C1b live-progress feature: reads every `tool_executions` row
 * recorded so far against a given `runs.id` — the same read shape
 * `@cloudops/adapters`' `RunService.getFullTrace()`/`getSwarmChildRuns()`
 * already use, duplicated here as a direct, minimal Kysely read for the same
 * reason `createSwarmChildRun`/`completeSwarmChildRun` above are direct
 * writes rather than calls into `RunService`: `@cloudops/adapters` depends
 * on `@cloudops/runtime`, so importing `RunService` from here would be
 * circular.
 *
 * Used by `packages/runtime/src/swarmProgressPoller.ts` to detect NEW rows
 * appearing WHILE a swarm worker/verifier/synthesizer's own oneshot call (or
 * the adaptive tier's single oneshot call) is still in flight — every tool
 * call any governed profile makes is written here by `CloudOpsMcpServer` the
 * instant it happens, well before that profile's final JSON response comes
 * back. Fails soft (returns `[]`, never throws): a progress-polling read
 * failure must never abort an otherwise-successful investigation stage —
 * mirrors `createSwarmChildRun`'s own fail-soft convention above.
 */
export async function listToolExecutionsForRun(
  runId: string,
  db: Kysely<DatabaseSchema> = getDatabase()
): Promise<ToolExecutionProgressRow[]> {
  try {
    const rows = await db
      .selectFrom("tool_executions")
      .select(["id", "tool_name", "status", "created_at"])
      .where("run_id", "=", runId)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      toolName: r.tool_name,
      status: r.status,
      createdAt: r.created_at
    }));
  } catch (err) {
    logger.warn({ err, runId }, "Swarm/adaptive progress poll read failed (non-fatal)");
    return [];
  }
}

export async function completeSwarmChildRun(
  runId: string | null,
  status: "COMPLETED" | "FAILED",
  finalResponse: string | undefined,
  db: Kysely<DatabaseSchema> = getDatabase()
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .updateTable("runs")
      .set({
        status,
        final_response: finalResponse || null,
        completed_at: new Date()
      } as any)
      .where("id", "=", runId)
      .execute();
  } catch (err) {
    logger.warn({ err, runId, status }, "Swarm child run trace-completion failed (non-fatal)");
  }
}
