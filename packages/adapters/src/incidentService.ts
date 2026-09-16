import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  ValidationError,
  NotFoundError,
  logger,
  validateIncidentContext,
  type IncidentContext,
  type IncidentEvidence,
  type RootCauseConclusion
} from "@cloudops/shared";
import type { AgentAdapter, AgentSession } from "@cloudops/runtime";
import { randomUUID } from "node:crypto";

export interface IncidentRecord {
  id: string;
  tenantId: string;
  provider: string;
  accountId: string;
  region: string;
  service: string;
  resourceId: string;
  severity: string;
  title: string;
  alertDescription: string;
  sourceMetadata: Record<string, unknown>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date | null;
}

export interface InvestigationRecord {
  id: string;
  incidentId: string;
  tenantId: string;
  agentId: string | null;
  sessionId: string | null;
  status: "INITIALIZING" | "INVESTIGATING" | "COMPLETED" | "FAILED" | "CANCELLED";
  rootCause: Record<string, unknown> | null;
  startedAt: Date;
  completedAt?: Date | null;
  errorMessage?: string | null;
}

export interface EvidenceRecord {
  id: string;
  incidentId: string;
  investigationId: string | null;
  tenantId: string;
  source: string;
  resource: string;
  observation: string;
  severity: string;
  rawPayload?: Record<string, unknown> | null;
  createdAt: Date;
}

export class IncidentService {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  async createIncident(tenantId: string, input: unknown): Promise<IncidentRecord> {
    const validation = validateIncidentContext(input);
    if (!validation.valid || !validation.context) {
      throw new ValidationError(`Failed to create incident: ${validation.errors?.join("; ")}`);
    }

    const ctx = validation.context;
    const incidentId = ctx.incidentId.startsWith("inc_") ? ctx.incidentId : `inc_${ctx.incidentId}`;

    const [row] = await this.db
      .insertInto("incidents")
      .values({
        id: incidentId,
        tenant_id: tenantId,
        provider: ctx.provider,
        account_id: ctx.accountId,
        region: ctx.region,
        service: ctx.service,
        resource_id: ctx.resourceId,
        severity: ctx.severity,
        title: ctx.title,
        alert_description: ctx.alertDescription,
        source_metadata: JSON.stringify(ctx.sourceMetadata),
        status: ctx.status || "OPEN",
        created_at: new Date(),
        updated_at: new Date()
      } as any)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          title: ctx.title,
          alert_description: ctx.alertDescription,
          updated_at: new Date()
        })
      )
      .returningAll()
      .execute();

    if (!row) {
      throw new Error("Failed to insert incident record");
    }

    return this.mapIncident(row);
  }

  async listIncidents(
    tenantId: string,
    options: {
      status?: string | undefined;
      severity?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    } = {}
  ): Promise<{ items: IncidentRecord[]; total: number }> {
    let query = this.db.selectFrom("incidents").selectAll().where("tenant_id", "=", tenantId);

    if (options.status) {
      query = query.where("status", "=", options.status);
    }
    if (options.severity) {
      query = query.where("severity", "=", options.severity);
    }
    if (options.from) {
      query = query.where("created_at", ">=", options.from);
    }
    if (options.to) {
      query = query.where("created_at", "<=", options.to);
    }

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = await query.orderBy("created_at", "desc").limit(limit).offset(offset).execute();

    const countRes = await this.db
      .selectFrom("incidents")
      .select((eb) => eb.fn.count("id").as("count"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();

    const total = Number(countRes?.count ?? rows.length);

    return {
      items: rows.map((r) => this.mapIncident(r)),
      total
    };
  }

  async getIncident(
    tenantId: string,
    incidentId: string
  ): Promise<{
    incident: IncidentRecord;
    investigations: InvestigationRecord[];
    evidence: EvidenceRecord[];
  }> {
    const row = await this.db
      .selectFrom("incidents")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", incidentId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundError(`Incident ${incidentId} not found for tenant ${tenantId}`);
    }

    const investigations = await this.db
      .selectFrom("investigations")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("incident_id", "=", incidentId)
      .orderBy("started_at", "desc")
      .execute();

    const evidence = await this.db
      .selectFrom("incident_evidence")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("incident_id", "=", incidentId)
      .orderBy("created_at", "asc")
      .execute();

    return {
      incident: this.mapIncident(row),
      investigations: investigations.map((inv) => this.mapInvestigation(inv)),
      evidence: evidence.map((ev) => this.mapEvidence(ev))
    };
  }

  /**
   * Starts an automated incident investigation session driven by an AgentAdapter.
   * Connects via AgentAdapter interface ONLY (CO-013).
   */
  async startInvestigation(params: {
    tenantId: string;
    incidentId: string;
    agentId: string;
    adapter: AgentAdapter;
  }): Promise<{
    investigation: InvestigationRecord;
    session: AgentSession;
  }> {
    const { tenantId, incidentId, agentId, adapter } = params;

    const incidentData = await this.getIncident(tenantId, incidentId);
    const incidentContext: IncidentContext = {
      incidentId: incidentData.incident.id,
      provider: incidentData.incident.provider as any,
      accountId: incidentData.incident.accountId,
      region: incidentData.incident.region,
      service: incidentData.incident.service,
      resourceId: incidentData.incident.resourceId,
      severity: incidentData.incident.severity as any,
      title: incidentData.incident.title,
      alertDescription: incidentData.incident.alertDescription,
      sourceMetadata: incidentData.incident.sourceMetadata as any,
      status: "INVESTIGATING"
    };

    const investigationId = `inv_${randomUUID()}`;

    // 1. Safely verify agent exists in DB if provided
    let resolvedAgentId: string | null = null;
    if (agentId) {
      const agentRow = await this.db
        .selectFrom("agents")
        .select("id")
        .where("id", "=", agentId)
        .executeTakeFirst();
      if (agentRow) {
        resolvedAgentId = agentRow.id;
      }
    }

    // Initialize investigation record
    const [invRow] = await this.db
      .insertInto("investigations")
      .values({
        id: investigationId,
        incident_id: incidentId,
        tenant_id: tenantId,
        agent_id: resolvedAgentId,
        status: "INVESTIGATING",
        started_at: new Date()
      } as any)
      .returningAll()
      .execute();

    // 2. Start Agent Session via Adapter Interface
    const session = await adapter.start({
      tenantId,
      agentId,
      scenarioId: "ecs-image-pull-failure",
      incidentContext: incidentContext as unknown as Record<string, unknown>
    });

    // Update investigation with session ID
    await this.db
      .updateTable("investigations")
      .set({ session_id: session.sessionId } as any)
      .where("id", "=", investigationId)
      .execute();

    // 3. Register streaming listeners for evidence and root-cause persistence
    adapter.onEvent(session.sessionId, async (evt) => {
      try {
        if (evt.type === "EVIDENCE") {
          const evidenceData = evt.data as any;
          await this.recordEvidence({
            id: evidenceData.evidenceId || `ev_${randomUUID()}`,
            incidentId,
            investigationId,
            tenantId,
            source: "AWS_INSPECTION",
            resource: incidentContext.resourceId,
            observation: evidenceData.observation || "Observed condition during investigation",
            severity: "WARNING",
            rawPayload: evidenceData.result || null
          });
        } else if (evt.type === "ROOT_CAUSE") {
          await this.completeInvestigation(tenantId, investigationId, evt.data);
        }
      } catch (listenerErr) {
        logger.error({ listenerErr }, "Error processing agent investigation event");
      }
    });

    return {
      investigation: this.mapInvestigation({
        ...invRow,
        session_id: session.sessionId
      }),
      session
    };
  }

  async recordEvidence(params: {
    id: string;
    incidentId: string;
    investigationId?: string | null | undefined;
    tenantId: string;
    source: string;
    resource: string;
    observation: string;
    severity?: string | undefined;
    rawPayload?: Record<string, unknown> | null | undefined;
  }): Promise<EvidenceRecord> {
    const [row] = await this.db
      .insertInto("incident_evidence")
      .values({
        id: params.id,
        incident_id: params.incidentId,
        investigation_id: params.investigationId ?? null,
        tenant_id: params.tenantId,
        source: params.source,
        resource: params.resource,
        observation: params.observation,
        severity: params.severity || "INFO",
        raw_payload: params.rawPayload ? JSON.stringify(params.rawPayload) : null,
        created_at: new Date()
      } as any)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          observation: params.observation,
          raw_payload: params.rawPayload ? JSON.stringify(params.rawPayload) : null
        })
      )
      .returningAll()
      .execute();

    return this.mapEvidence(row);
  }

  async completeInvestigation(
    tenantId: string,
    investigationId: string,
    rootCause: Record<string, unknown>
  ): Promise<InvestigationRecord> {
    const [row] = await this.db
      .updateTable("investigations")
      .set({
        status: "COMPLETED",
        root_cause: JSON.stringify(rootCause),
        completed_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", investigationId)
      .returningAll()
      .execute();

    if (!row) {
      throw new NotFoundError(`Investigation ${investigationId} not found`);
    }

    return this.mapInvestigation(row);
  }

  async getInvestigation(
    tenantId: string,
    id: string
  ): Promise<{ investigation: InvestigationRecord; evidence: EvidenceRecord[] } | null> {
    const row = await this.db
      .selectFrom("investigations")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();

    if (!row) return null;

    const evidence = await this.db
      .selectFrom("incident_evidence")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("investigation_id", "=", id)
      .orderBy("created_at", "asc")
      .execute();

    return {
      investigation: this.mapInvestigation(row),
      evidence: evidence.map((e) => this.mapEvidence(e))
    };
  }


  async failInvestigation(
    tenantId: string,
    investigationId: string,
    errorMessage: string
  ): Promise<InvestigationRecord> {
    const [row] = await this.db
      .updateTable("investigations")
      .set({
        status: "FAILED",
        error_message: errorMessage,
        completed_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", investigationId)
      .returningAll()
      .execute();

    if (!row) {
      throw new NotFoundError(`Investigation ${investigationId} not found`);
    }

    return this.mapInvestigation(row);
  }

  private mapIncident(row: any): IncidentRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      accountId: row.account_id,
      region: row.region,
      service: row.service,
      resourceId: row.resource_id,
      severity: row.severity,
      title: row.title,
      alertDescription: row.alert_description,
      sourceMetadata:
        typeof row.source_metadata === "string"
          ? JSON.parse(row.source_metadata)
          : row.source_metadata || {},
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null
    };
  }

  private mapInvestigation(row: any): InvestigationRecord {
    return {
      id: row.id,
      incidentId: row.incident_id,
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      status: row.status,
      rootCause:
        typeof row.root_cause === "string" ? JSON.parse(row.root_cause) : row.root_cause || null,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      errorMessage: row.error_message
    };
  }

  private mapEvidence(row: any): EvidenceRecord {
    return {
      id: row.id,
      incidentId: row.incident_id,
      investigationId: row.investigation_id,
      tenantId: row.tenant_id,
      source: row.source,
      resource: row.resource,
      observation: row.observation,
      severity: row.severity,
      rawPayload:
        typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload,
      createdAt: new Date(row.created_at)
    };
  }
}
