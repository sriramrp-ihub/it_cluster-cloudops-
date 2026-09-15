import { createHash } from "node:crypto";
import { getDatabase } from "@cloudops/database";
import { AuditService } from "@cloudops/audit";
import {
  generateApprovalId,
  NotFoundError,
  ValidationError,
  PolicyViolationError,
  IdempotencyConflictError,
  SignatureVerificationError,
  type AgentId,
  type ApprovalId,
  type ApprovalStatus,
  type TenantId
} from "@cloudops/shared";
import { OperatorSignatureService } from "./signatures.js";

export interface CreateApprovalParams {
  tenantId: TenantId;
  agentId: AgentId;
  toolName: string;
  operationType?: string | undefined;
  rawPayload: Record<string, unknown>;
  runId?: string | undefined;
  expiresInSeconds?: number | undefined;
  dryRunDiff?: Record<string, unknown> | null | undefined;
  previousStateSnapshot?: Record<string, unknown> | null | undefined;
}

export interface ApproveParams {
  reviewedBy: string;
  signature: string;
  publicKeyPem: string;
  signedAt?: Date;
}

export interface ApprovalRecord {
  id: ApprovalId;
  tenantId: string;
  agentId: string;
  toolName: string;
  operationType: string;
  operationPayloadHash: string;
  rawPayload: Record<string, unknown>;
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  signature: string | null;
  signedBy: string | null;
  signedAt: Date | null;
  idempotencyKey: string | null;
  escalatedAt: Date | null;
  executionResult: Record<string, unknown> | null;
  errorMessage: string | null;
  expiresAt: Date;
  createdAt: Date;
  dryRunDiff?: Record<string, unknown> | null;
  previousStateSnapshot?: Record<string, unknown> | null;
}

export class ApprovalService {
  private auditService: AuditService;

  constructor(auditService?: AuditService) {
    this.auditService = auditService || new AuditService();
  }

  /**
   * Computes deterministic SHA-256 hash of canonicalized JSON payload.
   */
  static hashPayload(payload: Record<string, unknown>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Create an operation-bound approval request.
   * Cryptographically binds the approval to the operation payload hash.
   * Default TTL: 4 hours (14,400 seconds).
   */
  async createApprovalRequest(params: CreateApprovalParams): Promise<ApprovalRecord> {
    const db = getDatabase();
    const id = generateApprovalId();
    const payloadHash = ApprovalService.hashPayload(params.rawPayload);
    const ttl = params.expiresInSeconds || 14400; // 4 hours default TTL
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const opType = params.operationType || "MUTATION";
    const now = new Date();

    await db
      .insertInto("approvals")
      .values({
        id,
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        run_id: params.runId || null,
        operation_type: opType,
        tool_name: params.toolName,
        operation_payload_hash: payloadHash,
        raw_payload: JSON.stringify(params.rawPayload) as any,
        status: "PENDING",
        expires_at: expiresAt,
        dry_run_diff: params.dryRunDiff ? JSON.stringify(params.dryRunDiff) as any : null,
        previous_state_snapshot: params.previousStateSnapshot ? JSON.stringify(params.previousStateSnapshot) as any : null,
        created_at: now
      })
      .execute();

    await this.auditService.recordEvent({
      tenantId: params.tenantId,
      agentId: params.agentId,
      runId: params.runId as any,
      eventType: "APPROVAL_REQUESTED",
      actorType: "AGENT",
      actorId: params.agentId,
      payload: {
        approvalId: id,
        toolName: params.toolName,
        operationType: opType,
        operationPayloadHash: payloadHash,
        expiresAt: expiresAt.toISOString()
      }
    });

    return {
      id,
      tenantId: params.tenantId,
      agentId: params.agentId,
      toolName: params.toolName,
      operationType: opType,
      operationPayloadHash: payloadHash,
      rawPayload: params.rawPayload,
      status: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      signature: null,
      signedBy: null,
      signedAt: null,
      idempotencyKey: null,
      escalatedAt: null,
      executionResult: null,
      errorMessage: null,
      expiresAt,
      createdAt: now,
      dryRunDiff: params.dryRunDiff || null,
      previousStateSnapshot: params.previousStateSnapshot || null
    };
  }

  /**
   * Retrieve approval request by ID.
   * Auto-expires approvals past TTL.
   */
  async getApproval(tenantId: string, approvalId: ApprovalId): Promise<ApprovalRecord | null> {
    const db = getDatabase();
    const row = await db
      .selectFrom("approvals")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", approvalId)
      .executeTakeFirst();

    if (!row) return null;

    let status = row.status as ApprovalStatus;
    const expiresAt = new Date(row.expires_at);

    // Auto-expire if past TTL and still pending
    if (status === "PENDING" && new Date() > expiresAt) {
      status = "EXPIRED";
      await db
        .updateTable("approvals")
        .set({ status: "EXPIRED" })
        .where("id", "=", approvalId)
        .where("status", "=", "PENDING")
        .execute();

      await this.auditService.recordEvent({
        tenantId: row.tenant_id as any,
        agentId: row.agent_id as any,
        eventType: "APPROVAL_EXPIRED",
        actorType: "SYSTEM",
        actorId: "sys_ttl_reaper",
        payload: { approvalId, toolName: row.tool_name }
      });
    }

    return {
      id: row.id as ApprovalId,
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      toolName: row.tool_name,
      operationType: row.operation_type,
      operationPayloadHash: row.operation_payload_hash,
      rawPayload: typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload,
      status,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
      signature: row.signature,
      signedBy: row.signed_by,
      signedAt: row.signed_at ? new Date(row.signed_at) : null,
      idempotencyKey: row.idempotency_key,
      escalatedAt: row.escalated_at ? new Date(row.escalated_at) : null,
      executionResult: row.execution_result ? (typeof row.execution_result === "string" ? JSON.parse(row.execution_result) : row.execution_result) : null,
      errorMessage: row.error_message,
      expiresAt,
      createdAt: new Date(row.created_at),
      dryRunDiff: row.dry_run_diff ? (typeof row.dry_run_diff === "string" ? JSON.parse(row.dry_run_diff) : row.dry_run_diff) : null,
      previousStateSnapshot: row.previous_state_snapshot ? (typeof row.previous_state_snapshot === "string" ? JSON.parse(row.previous_state_snapshot) : row.previous_state_snapshot) : null
    };
  }

  /**
   * List active pending approvals for a tenant (auto-expiring stale ones).
   */
  async listPending(tenantId: string): Promise<ApprovalRecord[]> {
    const db = getDatabase();
    const rows = await db
      .selectFrom("approvals")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "PENDING")
      .orderBy("created_at", "desc")
      .execute();

    const result: ApprovalRecord[] = [];
    const now = new Date();

    for (const row of rows) {
      const expiresAt = new Date(row.expires_at);
      if (now > expiresAt) {
        // Expire in database
        await db
          .updateTable("approvals")
          .set({ status: "EXPIRED" })
          .where("id", "=", row.id)
          .where("status", "=", "PENDING")
          .execute();

        await this.auditService.recordEvent({
          tenantId: row.tenant_id as any,
          agentId: row.agent_id as any,
          eventType: "APPROVAL_EXPIRED",
          actorType: "SYSTEM",
          actorId: "sys_ttl_reaper",
          payload: { approvalId: row.id, toolName: row.tool_name }
        });
      } else {
        result.push({
          id: row.id as ApprovalId,
          tenantId: row.tenant_id,
          agentId: row.agent_id,
          toolName: row.tool_name,
          operationType: row.operation_type,
          operationPayloadHash: row.operation_payload_hash,
          rawPayload: typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload,
          status: "PENDING",
          reviewedBy: row.reviewed_by,
          reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
          signature: row.signature,
          signedBy: row.signed_by,
          signedAt: row.signed_at ? new Date(row.signed_at) : null,
          idempotencyKey: row.idempotency_key,
          escalatedAt: row.escalated_at ? new Date(row.escalated_at) : null,
          executionResult: null,
          errorMessage: null,
          expiresAt,
          createdAt: new Date(row.created_at),
          dryRunDiff: row.dry_run_diff ? (typeof row.dry_run_diff === "string" ? JSON.parse(row.dry_run_diff) : row.dry_run_diff) : null,
          previousStateSnapshot: row.previous_state_snapshot ? (typeof row.previous_state_snapshot === "string" ? JSON.parse(row.previous_state_snapshot) : row.previous_state_snapshot) : null
        });
      }
    }

    return result;
  }

  /**
   * Escalates unactioned pending approvals past threshold minutes (default 30 mins).
   */
  async escalatePendingApprovals(tenantId: string, thresholdMinutes = 30): Promise<ApprovalRecord[]> {
    const db = getDatabase();
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const rows = await db
      .selectFrom("approvals")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "PENDING")
      .where("created_at", "<=", thresholdDate)
      .where("escalated_at", "is", null)
      .execute();

    const escalated: ApprovalRecord[] = [];
    const now = new Date();

    for (const row of rows) {
      await db
        .updateTable("approvals")
        .set({ escalated_at: now })
        .where("id", "=", row.id)
        .execute();

      await this.auditService.recordEvent({
        tenantId: row.tenant_id as any,
        agentId: row.agent_id as any,
        eventType: "APPROVAL_ESCALATED",
        actorType: "SYSTEM",
        actorId: "sys_escalation_engine",
        payload: {
          approvalId: row.id,
          toolName: row.tool_name,
          ageMinutes: Math.round((now.getTime() - new Date(row.created_at).getTime()) / 60000)
        }
      });

      const updated = await this.getApproval(tenantId, row.id as ApprovalId);
      if (updated) escalated.push(updated);
    }

    return escalated;
  }

  /**
   * Human operator cryptographically signs and approves the mutation request.
   * Requires non-repudiable Ed25519 digital signature.
   */
  async approve(tenantId: string, approvalId: ApprovalId, params: ApproveParams): Promise<ApprovalRecord> {
    const db = getDatabase();
    const approval = await this.getApproval(tenantId, approvalId);
    if (!approval) throw new NotFoundError(`Approval request ${approvalId} not found`);

    if (approval.status === "EXPIRED" || new Date() > approval.expiresAt) {
      throw new ValidationError("Approval request has expired and cannot be approved");
    }

    if (approval.status !== "PENDING") {
      throw new ValidationError(`Approval request is already ${approval.status}`);
    }

    const signedAt = params.signedAt || new Date();

    // Verify operator digital signature
    OperatorSignatureService.assertValidSignature(
      approvalId,
      approval.operationPayloadHash,
      signedAt.getTime(),
      params.signature,
      params.publicKeyPem
    );

    const now = new Date();
    await db
      .updateTable("approvals")
      .set({
        status: "APPROVED",
        reviewed_by: params.reviewedBy,
        reviewed_at: now,
        signature: params.signature,
        signed_by: params.reviewedBy,
        signed_at: signedAt
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", approvalId)
      .execute();

    await this.auditService.recordEvent({
      tenantId: approval.tenantId as any,
      agentId: approval.agentId as any,
      eventType: "APPROVAL_GRANTED",
      actorType: "USER",
      actorId: params.reviewedBy,
      payload: {
        approvalId,
        toolName: approval.toolName,
        operationPayloadHash: approval.operationPayloadHash,
        signedBy: params.reviewedBy,
        signedAt: signedAt.toISOString()
      }
    });

    return {
      ...approval,
      status: "APPROVED",
      reviewedBy: params.reviewedBy,
      reviewedAt: now,
      signature: params.signature,
      signedBy: params.reviewedBy,
      signedAt
    };
  }

  /**
   * Human operator rejects the mutation request.
   */
  async reject(tenantId: string, approvalId: ApprovalId, reviewedBy: string, reason?: string): Promise<ApprovalRecord> {
    const db = getDatabase();
    const approval = await this.getApproval(tenantId, approvalId);
    if (!approval) throw new NotFoundError(`Approval request ${approvalId} not found`);

    if (approval.status !== "PENDING") {
      throw new ValidationError(`Approval request is already ${approval.status}`);
    }

    const now = new Date();
    await db
      .updateTable("approvals")
      .set({
        status: "REJECTED",
        reviewed_by: reviewedBy,
        reviewed_at: now,
        error_message: reason || "Rejected by operator"
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", approvalId)
      .execute();

    await this.auditService.recordEvent({
      tenantId: approval.tenantId as any,
      agentId: approval.agentId as any,
      eventType: "APPROVAL_REJECTED",
      actorType: "USER",
      actorId: reviewedBy,
      payload: {
        approvalId,
        toolName: approval.toolName,
        reason: reason || "Rejected by operator"
      }
    });

    return {
      ...approval,
      status: "REJECTED",
      reviewedBy,
      reviewedAt: now,
      errorMessage: reason || "Rejected by operator"
    };
  }

  /**
   * Executes an approved operation with:
   * 1. Direct execution prevention for PENDING (Option A enforcement)
   * 2. Idempotency guard and atomic in-flight EXECUTING state
   * 3. Pre-execution SHA-256 payload hash verification (tamper protection)
   * 4. Crash-recovery idempotency guarantee
   * 5. Immutable audit trail logging
   */
  async executeApproval<T = unknown>(
    tenantId: string,
    approvalId: ApprovalId,
    executor: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<T>
  ): Promise<T> {
    const db = getDatabase();
    const approval = await this.getApproval(tenantId, approvalId);
    if (!approval) throw new NotFoundError(`Approval request ${approvalId} not found`);

    // 1. Invariant: Direct execution without operator approval is strictly prohibited (Option A)
    if (approval.status === "PENDING") {
      throw new PolicyViolationError(
        `Cannot execute mutation '${approval.toolName}' in status PENDING: direct execution without signed operator approval is prohibited.`
      );
    }

    // 2. Status validity checks
    if (approval.status === "REJECTED") {
      throw new ValidationError(`Cannot execute rejected approval request ${approvalId}`);
    }
    if (approval.status === "EXPIRED" || new Date() > approval.expiresAt) {
      throw new ValidationError(`Cannot execute expired approval request ${approvalId}`);
    }

    // 3. Idempotency and In-Flight check
    if (approval.status === "EXECUTING" || approval.status === "EXECUTED") {
      throw new IdempotencyConflictError(
        `Approval ${approvalId} is already in state ${approval.status} with idempotency key '${approval.idempotencyKey}'. Cannot re-execute.`
      );
    }

    if (approval.status !== "APPROVED") {
      throw new ValidationError(`Cannot execute approval in state ${approval.status}`);
    }

    // 4. Operator Signature Verification Check
    if (!approval.signature || !approval.signedBy) {
      throw new SignatureVerificationError(
        `Cannot execute approval ${approvalId}: missing verified operator signature.`
      );
    }

    // 5. Pre-Execution Payload Tamper Verification
    const computedHash = ApprovalService.hashPayload(approval.rawPayload);
    if (computedHash !== approval.operationPayloadHash) {
      throw new ValidationError(
        `Security violation: operation payload hash mismatch! Stored payload hash does not match computed hash (tamper attempt detected).`
      );
    }

    // 6. Acquire Execution Lock: Transition to EXECUTING with idempotency key
    const idempotencyKey = `idemp_${approvalId}`;
    const lockResult = await db
      .updateTable("approvals")
      .set({
        status: "EXECUTING",
        idempotency_key: idempotencyKey
      })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", approvalId)
      .where("status", "=", "APPROVED")
      .executeTakeFirst();

    if (Number(lockResult.numUpdatedRows || 0) === 0) {
      throw new IdempotencyConflictError(
        `Failed to acquire execution lock on approval ${approvalId}: state transitioned concurrently.`
      );
    }

    await this.auditService.recordEvent({
      tenantId: approval.tenantId as any,
      agentId: approval.agentId as any,
      eventType: "CLOUD_OPERATION_STARTED",
      actorType: "SYSTEM",
      actorId: "sys_execution_engine",
      payload: {
        approvalId,
        toolName: approval.toolName,
        idempotencyKey
      }
    });

    // 7. Dispatch to cloud executor
    try {
      const result = await executor(approval.rawPayload, idempotencyKey);

      await db
        .updateTable("approvals")
        .set({
          status: "EXECUTED",
          consumed_at: new Date(),
          execution_result: JSON.stringify(result) as any
        })
        .where("id", "=", approvalId)
        .execute();

      await this.auditService.recordEvent({
        tenantId: approval.tenantId as any,
        agentId: approval.agentId as any,
        eventType: "CLOUD_OPERATION_COMPLETED",
        actorType: "SYSTEM",
        actorId: "sys_execution_engine",
        payload: {
          approvalId,
          toolName: approval.toolName,
          idempotencyKey,
          status: "SUCCESS"
        }
      });

      return result;
    } catch (err: any) {
      await db
        .updateTable("approvals")
        .set({
          status: "EXECUTION_FAILED",
          error_message: err.message
        })
        .where("id", "=", approvalId)
        .execute();

      await this.auditService.recordEvent({
        tenantId: approval.tenantId as any,
        agentId: approval.agentId as any,
        eventType: "CLOUD_OPERATION_FAILED",
        actorType: "SYSTEM",
        actorId: "sys_execution_engine",
        payload: {
          approvalId,
          toolName: approval.toolName,
          idempotencyKey,
          error: err.message
        }
      });

      throw err;
    }
  }
}
