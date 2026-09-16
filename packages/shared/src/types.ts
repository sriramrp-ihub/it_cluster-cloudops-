/**
 * Core domain enums and types for CloudOps.
 * These types are provider-agnostic and runtime-agnostic.
 */

export const AgentStatus = {
  INVITED: "INVITED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REGISTERED: "REGISTERED",
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  REVOKED: "REVOKED",
  SUSPENDED: "SUSPENDED"
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const SessionStatus = {
  REGISTERING: "REGISTERING",
  CHALLENGE_ISSUED: "CHALLENGE_ISSUED",
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED"
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const ApprovalStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  CONSUMED: "CONSUMED",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  EXECUTION_FAILED: "EXECUTION_FAILED"
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const RunStatus = {
  CREATED: "CREATED",
  RUNNING: "RUNNING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const EventType = {
  RUN_CREATED: "RUN_CREATED",
  AGENT_REQUESTED: "AGENT_REQUESTED",
  AGENT_CONNECTED: "AGENT_CONNECTED",
  AGENT_DISCONNECTED: "AGENT_DISCONNECTED",
  TOOL_REQUESTED: "TOOL_REQUESTED",
  CAPABILITY_CHECKED: "CAPABILITY_CHECKED",
  SECURITY_CHECKED: "SECURITY_CHECKED",
  POLICY_EVALUATED: "POLICY_EVALUATED",
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  APPROVAL_GRANTED: "APPROVAL_GRANTED",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",
  JIT_CREDENTIAL_ISSUED: "JIT_CREDENTIAL_ISSUED",
  CLOUD_OPERATION_STARTED: "CLOUD_OPERATION_STARTED",
  CLOUD_OPERATION_COMPLETED: "CLOUD_OPERATION_COMPLETED",
  TOOL_RESULT_RETURNED: "TOOL_RESULT_RETURNED",
  AGENT_RESPONSE: "AGENT_RESPONSE",
  RUN_COMPLETED: "RUN_COMPLETED",
  RUN_FAILED: "RUN_FAILED"
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const PolicyDecision = {
  ALLOW: "ALLOW",
  DENY: "DENY",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED"
} as const;
export type PolicyDecision = (typeof PolicyDecision)[keyof typeof PolicyDecision];

export const RiskLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL"
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const ToolOperationType = {
  READ_ONLY: "READ_ONLY",
  MUTATION: "MUTATION",
  DEPLOY: "DEPLOY"
} as const;
export type ToolOperationType = (typeof ToolOperationType)[keyof typeof ToolOperationType];

export const CapabilityTier = {
  READ: "read",
  MUTATE: "mutate",
  DEPLOY: "deploy"
} as const;
export type CapabilityTier = (typeof CapabilityTier)[keyof typeof CapabilityTier];

/**
 * Loop 1: Agent Onboarding-Time Approval (Identity & Scope Grant)
 */
export interface AgentJoinApproval {
  id: string;
  inviteId: string;
  tenantId: string;
  agentName: string;
  agentType: string;
  agentVersion: string;
  gatewayProtocol: string;
  declaredCapabilities: string[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}

/**
 * Loop 2: Runtime Per-Operation Approval (HITL Mutation & Deployment Gate)
 */
export interface OperationApproval {
  id: string;
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

export const CloudProvider = {
  AWS: "AWS",
  AZURE: "AZURE",
  GCP: "GCP"
} as const;
export type CloudProvider = (typeof CloudProvider)[keyof typeof CloudProvider];

export const CredentialType = {
  INVITE_TOKEN: "INVITE_TOKEN",
  CLAIM_CREDENTIAL: "CLAIM_CREDENTIAL",
  RUNTIME_CREDENTIAL: "RUNTIME_CREDENTIAL",
  JIT_CLOUD_CREDENTIAL: "JIT_CLOUD_CREDENTIAL"
} as const;
export type CredentialType = (typeof CredentialType)[keyof typeof CredentialType];

export const CredentialStatus = {
  ACTIVE: "ACTIVE",
  GRACE_PERIOD: "GRACE_PERIOD",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED"
} as const;
export type CredentialStatus = (typeof CredentialStatus)[keyof typeof CredentialStatus];

export const JoinRequestStatus = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED"
} as const;
export type JoinRequestStatus = (typeof JoinRequestStatus)[keyof typeof JoinRequestStatus];

export const InviteStatus = {
  ACTIVE: "ACTIVE",
  CLAIMED: "CLAIMED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED"
} as const;
export type InviteStatus = (typeof InviteStatus)[keyof typeof InviteStatus];

export const CloudAccountStatus = {
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  FAILED: "FAILED",
  DISCONNECTED: "DISCONNECTED"
} as const;
export type CloudAccountStatus = (typeof CloudAccountStatus)[keyof typeof CloudAccountStatus];

/**
 * CO-010: Formal Incident Input Contract
 */
export interface IncidentContext {
  incidentId: string;
  provider: CloudProvider | "AWS" | "AZURE" | "GCP" | "aws" | "azure" | "gcp";
  accountId: string;
  region: string;
  service: string;
  resourceId: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  alertDescription: string;
  sourceMetadata: {
    monitorId?: string;
    triggerMetric?: string;
    threshold?: string;
    startedAt: string;
  };
  status?: "OPEN" | "INVESTIGATING" | "IDENTIFIED" | "REMEDIATING" | "RESOLVED" | "CLOSED";
}

/**
 * Validates incident context and fails closed on any missing or invalid field.
 */
export function validateIncidentContext(input: unknown): {
  valid: boolean;
  errors?: string[];
  context?: IncidentContext;
} {
  if (!input || typeof input !== "object") {
    return { valid: false, errors: ["Incident context must be a non-null object"] };
  }

  const candidate = input as Record<string, unknown>;
  const errors: string[] = [];

  const requiredFields = [
    "incidentId",
    "provider",
    "accountId",
    "region",
    "service",
    "resourceId",
    "severity",
    "alertDescription"
  ] as const;

  for (const field of requiredFields) {
    if (!candidate[field] || typeof candidate[field] !== "string" || (candidate[field] as string).trim() === "") {
      errors.push(`Missing or invalid required string field: ${field}`);
    }
  }

  if (candidate.severity && !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(candidate.severity as string)) {
    errors.push(`Invalid severity: ${candidate.severity}. Must be CRITICAL, HIGH, MEDIUM, or LOW`);
  }

  if (candidate.sourceMetadata && typeof candidate.sourceMetadata !== "object") {
    errors.push("sourceMetadata must be an object if provided");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    context: {
      incidentId: String(candidate.incidentId),
      provider: candidate.provider as IncidentContext["provider"],
      accountId: String(candidate.accountId),
      region: String(candidate.region),
      service: String(candidate.service),
      resourceId: String(candidate.resourceId),
      severity: candidate.severity as IncidentContext["severity"],
      title: candidate.title ? String(candidate.title) : `Incident ${candidate.incidentId} - ${candidate.service}`,
      alertDescription: String(candidate.alertDescription),
      sourceMetadata: (candidate.sourceMetadata as IncidentContext["sourceMetadata"]) || {
        startedAt: new Date().toISOString()
      },
      status: (candidate.status as IncidentContext["status"]) || "OPEN"
    }
  };
}

/**
 * CO-012: Normalized Evidence Schema
 */
export interface IncidentEvidence {
  id: string;
  incidentId: string;
  source: "ECS" | "CLOUDWATCH_METRICS" | "CLOUDWATCH_LOGS" | "ALB" | "ECR" | "IAM" | string;
  resource: string;
  timestamp: string;
  observation: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  rawPayload?: Record<string, unknown>;
}

/**
 * CO-012: Machine-Checkable Root Cause Schema
 */
export interface RootCauseConclusion {
  incidentId: string;
  cause: string;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  affectedResources: string[];
  alternativeHypotheses?: Array<{ hypothesis: string; eliminatedReason: string }>;
  recommendedRemediation?: {
    action: string;
    target: string;
    proposedPayload: Record<string, unknown>;
    riskLevel: RiskLevel;
  };
}

