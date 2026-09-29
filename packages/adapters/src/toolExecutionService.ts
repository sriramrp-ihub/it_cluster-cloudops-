import { randomUUID, randomBytes } from "node:crypto";
import { getDatabase } from "@cloudops/database";
import { generateRunId } from "@cloudops/shared";
import { startRunSpan, endRunSpanOk, endRunSpanError } from "./tracing.js";
import type { Span } from "@opentelemetry/api";

// Phase 3.9: holds the in-flight span for a run between createRun (start)
// and completeRun (end) — module-level rather than per-instance since
// RunService is constructed fresh in more than one place (routes, tests)
// but a run's lifecycle must resolve to exactly one span regardless of
// which RunService instance calls completeRun.
const activeRunSpans = new Map<string, Span>();

export interface CreateRunParams {
  tenantId: string;
  agentId: string;
  sessionId?: string | undefined;
  userPrompt: string;
  /**
   * ADR-0007 Phase C1b: links this run back to an outer investigation's run
   * (e.g. a swarm worker/verifier/synthesizer's own run, linked to the
   * investigation that triggered the swarm) — see
   * database/migrations/021_run_parent_child.sql. Additive and optional;
   * every existing caller that never sets this keeps getting
   * `parent_run_id: null`, exactly as before this column existed.
   */
  parentRunId?: string | undefined;
}

export interface RunRecord {
  id: string;
  tenantId: string;
  agentId: string;
  sessionId: string | null;
  userPrompt: string;
  status: string;
  finalResponse: string | null;
  traceId: string;
  createdAt: Date;
  completedAt: Date | null;
  parentRunId: string | null;
}

/**
 * Phase 3.5/3.6: runs and tool_executions existed as schema since the
 * initial migration but nothing ever wrote to either — every investigation
 * ran with zero persisted record of what was actually called, why, and on
 * what evidence, beyond the final root-cause summary. This is the actual
 * write path.
 */
export class RunService {
  async createRun(params: CreateRunParams): Promise<RunRecord> {
    const db = getDatabase();
    const id = generateRunId();
    const now = new Date();
    // W3C trace-id format (32 hex chars) — the correlation key Phase 3.9's
    // OTel collector resolves to a real span. Generated per-run rather than
    // per-tool-call: every tool_execution/approval/audit_event under this
    // run already threads run_id, so they inherit this trace via that join
    // rather than needing their own copy of the column.
    const traceId = randomBytes(16).toString("hex");

    await db
      .insertInto("runs")
      .values({
        id,
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        session_id: params.sessionId || null,
        user_prompt: params.userPrompt,
        status: "RUNNING",
        trace_id: traceId,
        parent_run_id: params.parentRunId || null,
        created_at: now
      } as any)
      .execute();

    const span = startRunSpan(traceId, "cloudops.run", {
      "cloudops.run_id": id,
      "cloudops.tenant_id": params.tenantId,
      "cloudops.agent_id": params.agentId
    });
    activeRunSpans.set(id, span);

    return {
      id,
      tenantId: params.tenantId,
      agentId: params.agentId,
      sessionId: params.sessionId || null,
      userPrompt: params.userPrompt,
      status: "RUNNING",
      finalResponse: null,
      traceId,
      createdAt: now,
      completedAt: null,
      parentRunId: params.parentRunId || null
    };
  }

  async completeRun(runId: string, status: "COMPLETED" | "FAILED", finalResponse?: string): Promise<void> {
    const db = getDatabase();
    await db
      .updateTable("runs")
      .set({
        status,
        final_response: finalResponse || null,
        completed_at: new Date()
      } as any)
      .where("id", "=", runId)
      .execute();

    const span = activeRunSpans.get(runId);
    if (span) {
      activeRunSpans.delete(runId);
      if (status === "COMPLETED") {
        endRunSpanOk(span, { "cloudops.run_status": status });
      } else {
        endRunSpanError(span, finalResponse || "Run failed");
      }
    }
  }

  /**
   * Phase 3.6: reconstructs the full action trace for a run — every tool
   * call, every approval it triggered, and every audit event recorded under
   * it — via three independent run_id-scoped queries (a single SQL statement
   * joining all three would fan out rows across unrelated tables since
   * tool_executions/approvals/audit_events aren't 1:1 with each other; this
   * is the "one query per table, one run_id" equivalent — every row anyone
   * needs to explain this run is reachable from this single call, not
   * scattered across lookups that each require knowing a different ID).
   */
  async getFullTrace(tenantId: string, runId: string) {
    const db = getDatabase();

    const run = await db
      .selectFrom("runs")
      .selectAll()
      .where("id", "=", runId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();

    if (!run) return null;

    const [toolExecutions, approvals, auditEvents] = await Promise.all([
      db.selectFrom("tool_executions").selectAll().where("run_id", "=", runId).orderBy("created_at", "asc").execute(),
      db.selectFrom("approvals").selectAll().where("run_id", "=", runId).orderBy("created_at", "asc").execute(),
      db.selectFrom("audit_events").selectAll().where("run_id", "=", runId).orderBy("created_at", "asc").execute()
    ]);

    return { run, toolExecutions, approvals, auditEvents };
  }

  /**
   * ADR-0008 Phase B (§4.4): resolves the one active (RUNNING) run for an
   * agent, for callers that know the agent but not the run id — chiefly
   * `CloudOpsMcpServer`, whose tool-call handler runs for whatever agent
   * authenticated the SSE connection, not for a run id anyone threaded in
   * explicitly. There should be at most one active investigation run per
   * agent at a time (every route that calls `createRun` does so once per
   * triggered investigation and completes it via `completeRun` before the
   * next one starts) — this returns the most recently created RUNNING run
   * as a best-effort resolution, not a strict single-row invariant enforced
   * at the schema level. Returns null (not a throw) when there is none,
   * e.g. an MCP connection with no investigation in flight (a bare
   * `/v1/agents/:id/test` probe) — callers must treat that as "no run to
   * attribute this call to", not as an error.
   */
  async findActiveRunId(tenantId: string, agentId: string): Promise<string | null> {
    const db = getDatabase();
    const row = await db
      .selectFrom("runs")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("agent_id", "=", agentId)
      .where("status", "=", "RUNNING")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    return row?.id ?? null;
  }

  /**
   * Lists recent runs for a tenant, newest first — feeds the observability
   * panel's run picker (Phase 3.7).
   */
  async listRuns(tenantId: string, limit = 25) {
    const db = getDatabase();
    return db
      .selectFrom("runs")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }
}

export interface RecordToolExecutionParams {
  runId: string;
  agentId: string;
  toolName: string;
  inputPayload: Record<string, unknown>;
  outputPayload?: unknown;
  status: string;
  durationMs?: number | undefined;
  errorMessage?: string | undefined;
  reasoningSnippet?: string | undefined;
  evidenceRefs?: string[] | undefined;
}

export class ToolExecutionService {
  async recordExecution(params: RecordToolExecutionParams): Promise<void> {
    const db = getDatabase();
    await db
      .insertInto("tool_executions")
      .values({
        id: `te_${randomUUID()}`,
        run_id: params.runId,
        agent_id: params.agentId,
        tool_name: params.toolName,
        input_payload: JSON.stringify(params.inputPayload) as any,
        output_payload: params.outputPayload !== undefined ? (JSON.stringify(params.outputPayload) as any) : null,
        status: params.status,
        duration_ms: params.durationMs ?? null,
        error_message: params.errorMessage ?? null,
        reasoning_snippet: params.reasoningSnippet ?? null,
        evidence_refs: params.evidenceRefs ?? [],
        created_at: new Date()
      } as any)
      .execute();
  }
}
