import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  generateClaimCredential,
  hashToken,
  logger,
  type ClaimCredential,
  type AgentId
} from "@cloudops/shared";
import { HermesProfileService } from "@cloudops/runtime";
import { InviteService } from "./invite.js";
import { JoinRequestRepository } from "./joinRequest.js";
import { recordAuditEvent } from "./audit.js";

export interface ClaimCredentialInput {
  inviteToken: string;
  joinRequestId: string;
}

export interface ClaimCredentialResult {
  agentId: AgentId;
  claimCredential: ClaimCredential;
  tenantId: string;
  status: "CLAIMED";
  nextAction: "REGISTER_GATEWAY";
}

export class ClaimService {
  constructor(
    private readonly inviteService: InviteService = new InviteService(),
    private readonly joinRequestRepo: JoinRequestRepository = new JoinRequestRepository(),
    private readonly db: Kysely<DatabaseSchema> = getDatabase(),
    private readonly hermesProfileService: HermesProfileService = new HermesProfileService()
  ) {}

  /**
   * Atomically claim a one-time bootstrap credential after human approval.
   * Uses PostgreSQL row locking (SELECT ... FOR UPDATE) to ensure strict concurrency safety:
   * exactly one claim succeeds; all other concurrent attempts fail with ConflictError.
   */
  async claimBootstrapCredential(input: ClaimCredentialInput): Promise<ClaimCredentialResult> {
    if (!input.inviteToken || !input.joinRequestId) {
      throw new ValidationError("Both inviteToken and joinRequestId are required for credential claim");
    }

    // 1. Verify possession of valid onboarding invite
    const invite = await this.inviteService.validateAndGetInvite(input.inviteToken);

    // 2. Verify approved join request associated with this invite
    const jr = await this.joinRequestRepo.findById(invite.tenantId, input.joinRequestId as any);
    if (!jr || jr.inviteId !== invite.id) {
      throw new AuthenticationError("Join request does not match the provided onboarding context");
    }

    if (jr.status !== "APPROVED" || !jr.agentId) {
      throw new ConflictError(`Cannot claim credential for join request in state '${jr.status}'. Must be 'APPROVED'.`);
    }

    const agentId = jr.agentId;

    // 3. Atomic consumption inside PostgreSQL transaction with row lock
    const result: ClaimCredentialResult = await this.db.transaction().execute(async (tx) => {
      // Lock the claim credentials row for this join request
      const claimRow = await tx
        .selectFrom("agent_claim_credentials")
        .selectAll()
        .where("join_request_id", "=", jr.id)
        .where("tenant_id", "=", invite.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!claimRow) {
        throw new NotFoundError("No bootstrap claim record found for this join request");
      }

      if (claimRow.status === "CONSUMED") {
        throw new ConflictError("Bootstrap credential has already been claimed and consumed");
      }

      if (claimRow.status !== "AVAILABLE") {
        throw new ConflictError(`Bootstrap credential is not available (status: '${claimRow.status}')`);
      }

      const now = new Date();
      if (new Date(claimRow.expires_at).getTime() <= now.getTime()) {
        throw new AuthenticationError("Claim credential has expired");
      }

      // Generate 256-bit cryptographically secure claim credential: co_agent_<64hex>
      const rawClaimCredential = generateClaimCredential();
      const claimTokenHash = hashToken(rawClaimCredential);

      // Transition claim credential to CONSUMED and record the hash
      await tx
        .updateTable("agent_claim_credentials")
        .set({
          status: "CONSUMED",
          claim_token_hash: claimTokenHash,
          consumed_at: now
        } as any)
        .where("id", "=", claimRow.id)
        .execute();

      // Transition invite to CLAIMED / CONSUMED
      await tx
        .updateTable("agent_invites")
        .set({
          status: "CLAIMED",
          claimed_at: now
        } as any)
        .where("id", "=", invite.id)
        .execute();

      // Transition agent to REGISTERED (Ready for Gateway registration in Phase 3; strictly NOT CONNECTED!)
      await tx
        .updateTable("agents")
        .set({
          status: "REGISTERED",
          updated_at: now
        } as any)
        .where("id", "=", agentId)
        .where("tenant_id", "=", invite.tenantId)
        .execute();

      // Record audit event
      await recordAuditEvent(
        {
          tenantId: invite.tenantId,
          eventType: "CLAIM_CREDENTIAL_CONSUMED",
          actorType: "AGENT",
          actorId: agentId,
          agentId,
          payload: {
            joinRequestId: jr.id,
            agentId
          }
        },
        tx,
        this.db
      );

      return {
        agentId,
        claimCredential: rawClaimCredential,
        tenantId: invite.tenantId,
        status: "CLAIMED",
        nextAction: "REGISTER_GATEWAY"
      };
    });

    // ADR-0008 Phase A: provision this agent's isolated, governed Hermes
    // profile now that its identity is real (post-commit — CLI subprocess
    // calls have no business running inside the DB transaction above).
    // Deliberately awaited rather than fire-and-forget, so a caller
    // inspecting the agent's governance status immediately after claim sees
    // an accurate result rather than a stale PENDING — but deliberately
    // caught rather than re-thrown: the credential claim itself already
    // committed and must not fail because Hermes's own lockdown couldn't be
    // confirmed. A failure here leaves governance_status='FAILED' (fail
    // closed, never silently marked usable) for diagnostics/an operator to
    // act on, without breaking this endpoint's existing response contract.
    try {
      await this.hermesProfileService.provisionProfile(result.tenantId, result.agentId);
    } catch (err: any) {
      logger.error(
        { err, agentId: result.agentId, tenantId: result.tenantId },
        "Hermes governed profile provisioning threw unexpectedly during credential claim"
      );
    }

    return result;
  }
}
