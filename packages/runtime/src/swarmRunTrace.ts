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
