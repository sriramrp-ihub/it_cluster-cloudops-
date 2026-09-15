import { randomBytes, randomUUID } from "node:crypto";

/**
 * Strongly typed identifiers used across CloudOps.
 * All IDs use cryptographically secure randomness via node:crypto.
 * Math.random() is NEVER used.
 */

export type AgentId = `ag_${string}`;
export type JoinRequestId = `jr_${string}`;
export type InviteToken = `co_inv_${string}`;
export type ClaimCredential = `co_agent_${string}`;
export type RunId = `run_${string}`;
export type ApprovalId = `appr_${string}`;
export type EventId = `evt_${string}`;
export type AuditId = `aud_${string}`;
export type CredentialId = `cred_${string}`;
export type SessionId = `sess_${string}`;
export type TenantId = `ten_${string}`;
export type CloudAccountId = `cld_${string}`;

/** Generate stable Cloud Account ID: cld_<uuid> */
export function generateCloudAccountId(): CloudAccountId {
  return `cld_${randomUUID()}`;
}

/** Generate Audit Event ID: aud_<uuid> */
export function generateAuditId(): AuditId {
  return `aud_${randomUUID()}`;
}

/** Generate stable Agent ID: ag_<uuid> */
export function generateAgentId(): AgentId {
  return `ag_${randomUUID()}`;
}

/** Generate declarative Join Request ID: jr_<uuid> */
export function generateJoinRequestId(): JoinRequestId {
  return `jr_${randomUUID()}`;
}

/**
 * Generate ephemeral Invite Token: co_inv_<randomHex>
 * Provides 192 bits (24 bytes) of cryptographically secure entropy.
 */
export function generateInviteToken(): InviteToken {
  return `co_inv_${randomBytes(24).toString("hex")}`;
}

/**
 * Generate single-use Claim Credential: co_agent_<randomHex>
 * Strictly enforces minimum 256 bits (32 bytes = 64 hex characters) of entropy.
 */
export function generateClaimCredential(): ClaimCredential {
  return `co_agent_${randomBytes(32).toString("hex")}`;
}

/** Generate Run ID: run_<uuid> */
export function generateRunId(): RunId {
  return `run_${randomUUID()}`;
}

/** Generate Approval ID: appr_<uuid> */
export function generateApprovalId(): ApprovalId {
  return `appr_${randomUUID()}`;
}

/** Generate Domain Event ID: evt_<uuid> */
export function generateEventId(): EventId {
  return `evt_${randomUUID()}`;
}

/** Generate Runtime Credential ID: cred_<uuid> */
export function generateCredentialId(): CredentialId {
  return `cred_${randomUUID()}`;
}

export type RuntimeCredentialToken = `cred_${string}`;

/**
 * Generate high-entropy runtime credential secret: cred_<randomHex>
 * Provides minimum 256 bits (32 bytes = 64 hex characters) of cryptographic entropy.
 */
export function generateRuntimeCredentialToken(): RuntimeCredentialToken {
  return `cred_${randomBytes(32).toString("hex")}`;
}

/** Generate Gateway Session ID: sess_<uuid> */
export function generateSessionId(): SessionId {
  return `sess_${randomUUID()}`;
}

/** Generate Tenant ID: ten_<uuid> */
export function generateTenantId(): TenantId {
  return `ten_${randomUUID()}`;
}

// Validator type guards
export function isAgentId(val: unknown): val is AgentId {
  return typeof val === "string" && /^ag_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function isJoinRequestId(val: unknown): val is JoinRequestId {
  return typeof val === "string" && /^jr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function isInviteToken(val: unknown): val is InviteToken {
  return typeof val === "string" && /^co_inv_[0-9a-f]{48}$/i.test(val);
}

export function isClaimCredential(val: unknown): val is ClaimCredential {
  return typeof val === "string" && /^co_agent_[0-9a-f]{64}$/i.test(val);
}

export function isRunId(val: unknown): val is RunId {
  return typeof val === "string" && /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function isApprovalId(val: unknown): val is ApprovalId {
  return typeof val === "string" && /^appr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function isEventId(val: unknown): val is EventId {
  return typeof val === "string" && /^evt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function isRuntimeCredentialToken(val: unknown): val is RuntimeCredentialToken {
  return typeof val === "string" && /^cred_[0-9a-f]{64}$/i.test(val);
}

export function isCloudAccountId(val: unknown): val is CloudAccountId {
  return typeof val === "string" && /^cld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}
