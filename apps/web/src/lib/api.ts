/**
 * CloudOps Frontend API Client
 * Interfaces with the CloudOps Control Plane API.
 * Encapsulates tenant and operator headers transparently.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface HealthResponse {
  status: "ok";
  timestamp: string;
  uptime: number;
}

export interface ReadinessResponse {
  status: "ready" | "not_ready";
  timestamp: string;
  dependencies: {
    database: "connected" | "unreachable";
  };
}

export interface AgentItem {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  version: string;
  runtimeProtocol: string;
  status: "INVITED" | "APPROVED" | "REGISTERED" | "CONNECTED" | "SUSPENDED" | "REVOKED";
  cloudAccountId: string | null;
  /** ADR-0008 Phase A: governed Hermes profile lockdown tracking. */
  hermesProfileName?: string | null;
  governanceStatus?: "PENDING" | "LOCKED_DOWN" | "FAILED";
  governanceVerifiedAt?: string | null;
  mcpRegistered?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceVerificationResult {
  agentId: string;
  hermesProfileName: string | null;
  governanceStatus: "PENDING" | "LOCKED_DOWN" | "FAILED";
  toolsetsLockedDown: boolean;
  enabledNativeToolsets: string[];
  mcpRegistered: boolean;
  mcpServers: string[];
  verifiedAt: string;
  errors: string[];
}

/**
 * ADR-0008 Phase A: triggers an on-demand, independent re-check of an
 * agent's governed Hermes profile (native toolsets still disabled, CloudOps
 * own MCP server still the only one registered) rather than trusting the
 * last-recorded status alone.
 */
export async function verifyAgentGovernance(
  id: string,
  tenantId?: string,
  operatorId?: string
): Promise<GovernanceVerificationResult> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}/verify-governance`, {
    method: "POST",
    headers: getAuthHeaders(tenantId, operatorId)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface JoinRequestItem {
  id: string;
  tenantId: string;
  inviteId: string;
  agentId?: string;
  agentName: string;
  agentType: string;
  agentVersion: string;
  gatewayProtocol: string;
  endpoint?: string;
  declaredCapabilities: string[];
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

const DEFAULT_TENANT = "ten_default_tenant";
const DEFAULT_OPERATOR = "op_admin_operator";

function getAuthHeaders(tenantId?: string, operatorId?: string): Record<string, string> {
  return {
    "x-tenant-id": tenantId || DEFAULT_TENANT,
    "x-operator-id": operatorId || DEFAULT_OPERATOR
  };
}

/**
 * Resolves the real signed-in operator/tenant for a Server Component by
 * forwarding its incoming cookie header to the same /v1/auth/session
 * endpoint the client uses — Server Components have no access to
 * OperatorContext, so without this they silently fell back to
 * DEFAULT_TENANT/DEFAULT_OPERATOR above, which is why the Overview page
 * (a Server Component) never reflected whatever the signed-in operator
 * actually connected.
 */
export async function resolveServerSession(
  cookieHeader: string
): Promise<{ tenantId: string; operatorId: string } | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API_BASE}/v1/auth/session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store"
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.operator?.tenantId || !body?.operator?.id) return null;
    return { tenantId: body.operator.tenantId, operatorId: body.operator.id };
  } catch {
    return null;
  }
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * Team membership — driven by the caller's own session cookie server-side
 * (not x-tenant-id/x-operator-id headers), so these always use
 * credentials: "include" rather than the getAuthHeaders() pattern the rest
 * of this file uses.
 */
export async function fetchTeam(): Promise<TeamMember[]> {
  const res = await fetch(`${API_BASE}/v1/auth/team`, { credentials: "include" });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.operators || [];
}

export async function addTeamMember(params: { name: string; email: string; password: string }): Promise<TeamMember> {
  const res = await fetch(`${API_BASE}/v1/auth/team`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.operator;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/auth/change-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }
}

/**
 * Real per-tenant monthly cost guardrail — the cap PolicyEngine's
 * FENCE_BUDGET_CAP rule checks every proposed mutation's estimated cost
 * against. Driven by session cookie, like team/password above.
 */
export async function fetchTenantBudget(): Promise<number> {
  const res = await fetch(`${API_BASE}/v1/auth/tenant/budget`, { credentials: "include" });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.monthlyBudgetLimitUsd;
}

export async function updateTenantBudget(monthlyBudgetLimitUsd: number): Promise<number> {
  const res = await fetch(`${API_BASE}/v1/auth/tenant/budget`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthlyBudgetLimitUsd })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.monthlyBudgetLimitUsd;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/healthz`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Health check failed with status: ${res.status}`);
  }
  return res.json();
}

export async function fetchReadiness(): Promise<ReadinessResponse> {
  const res = await fetch(`${API_BASE}/readyz`, { cache: "no-store" });
  return res.json();
}

export async function fetchAgents(tenantId?: string, operatorId?: string): Promise<AgentItem[]> {
  const res = await fetch(`${API_BASE}/v1/agents`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.items || [];
}

export async function fetchAgent(id: string, tenantId?: string, operatorId?: string): Promise<AgentItem> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function assignAgentCloudAccount(
  agentId: string,
  cloudAccountId: string | null,
  tenantId?: string,
  operatorId?: string
): Promise<{ id: string; cloudAccountId: string | null }> {
  const res = await fetch(`${API_BASE}/v1/agents/${agentId}/cloud-account`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({ cloudAccountId })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function syncAgentCapabilities(
  agentId: string,
  tenantId?: string,
  operatorId?: string
): Promise<{ id: string; capabilities: string[]; updatedRows: number }> {
  const res = await fetch(`${API_BASE}/v1/agents/${agentId}/sync-capabilities`, {
    method: "POST",
    headers: getAuthHeaders(tenantId, operatorId)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function deleteAgent(
  id: string,
  tenantId?: string,
  operatorId?: string
): Promise<{ success: boolean; message: string; deletedAgentId: string }> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function fetchJoinRequests(tenantId?: string, operatorId?: string, status?: string): Promise<JoinRequestItem[]> {
  const url = new URL(`${API_BASE}/v1/agent-join-requests`);
  if (status) url.searchParams.set("status", status);

  const res = await fetch(url.toString(), {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.items || [];
}

export interface CreateInviteOptions {
  expiresInSeconds?: number;
  agentName?: string;
  agentType?: "hermes" | "openclaw" | "custom" | string;
  instructions?: string;
}

export interface CreateInviteResponse {
  id: string;
  inviteId: string;
  inviteToken: string;
  tenantId: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  onboardingPrompt: string;
}

export async function createInvite(
  tenantId?: string,
  operatorId?: string,
  optionsOrExpires: number | CreateInviteOptions = 86400
): Promise<CreateInviteResponse> {
  const options: CreateInviteOptions = typeof optionsOrExpires === "number"
    ? { expiresInSeconds: optionsOrExpires }
    : optionsOrExpires;

  const res = await fetch(`${API_BASE}/v1/agent-invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({
      expiresInSeconds: options.expiresInSeconds ?? 86400,
      agentName: options.agentName,
      agentType: options.agentType,
      instructions: options.instructions
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    ...data,
    inviteId: data.id
  };
}

export async function approveJoinRequest(
  joinRequestId: string,
  tenantId?: string,
  operatorId?: string
): Promise<{ joinRequestId: string; agentId: string; status: string }> {
  const res = await fetch(`${API_BASE}/v1/agent-join-requests/${joinRequestId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function rejectJoinRequest(
  joinRequestId: string,
  tenantId?: string,
  operatorId?: string,
  reason?: string
): Promise<{ joinRequestId: string; status: string }> {
  const res = await fetch(`${API_BASE}/v1/agent-join-requests/${joinRequestId}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({ reason })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface CloudAccountItem {
  id: string;
  provider: "aws" | "gcp" | "azure" | string;
  accountId: string;
  region: string;
  roleArn?: string | null;
  status: "CONNECTED" | "CONNECTING" | "FAILED" | "DISCONNECTED" | string;
  createdAt: string;
}

export interface ConnectAwsPayload {
  provider: "aws";
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  assumeRoleArn?: string;
  externalId?: string;
}

export async function createCloudAccount(
  payload: ConnectAwsPayload,
  tenantId?: string,
  operatorId?: string
): Promise<CloudAccountItem> {
  const res = await fetch(`${API_BASE}/v1/cloud-accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `Failed to connect AWS account (HTTP ${res.status})`);
  }

  return res.json();
}

export async function fetchCloudAccounts(
  tenantId?: string,
  operatorId?: string
): Promise<CloudAccountItem[]> {
  const res = await fetch(`${API_BASE}/v1/cloud-accounts`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  if (Array.isArray(data)) {
    return data;
  }
  return data.items || [];
}

export async function deleteCloudAccount(
  id: string,
  tenantId?: string,
  operatorId?: string
): Promise<{ success: boolean; id: string }> {
  const res = await fetch(`${API_BASE}/v1/cloud-accounts/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(tenantId, operatorId)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export type WorkloadCategory = "ECS_SERVICE" | "EC2_INSTANCE" | "RDS_DATABASE" | "S3_BUCKET";
export type WorkloadStatus = "HEALTHY" | "ATTENTION" | "STOPPED" | "PAUSED" | "STARTING";

export interface DiscoveredWorkload {
  id: string;
  name: string;
  type: WorkloadCategory;
  cluster?: string;
  status: WorkloadStatus;
  region: string;
  desiredCount?: number;
  runningCount?: number;
  launchType?: string;
  taskDefinition?: string;
  instanceType?: string;
  ipAddress?: string;
  createdAt?: string;
}

export async function fetchAccountWorkloads(
  accountId: string,
  tenantId?: string,
  operatorId?: string
): Promise<{ workloads: DiscoveredWorkload[]; sessionActive: boolean }> {
  const res = await fetch(`${API_BASE}/v1/cloud-accounts/${accountId}/workloads`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface IncidentItem {
  id: string;
  tenantId: string;
  provider: string;
  accountId: string;
  region: string;
  service: string;
  resourceId: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
  title: string;
  alertDescription: string;
  status: "OPEN" | "INVESTIGATING" | "IDENTIFIED" | "REMEDIATING" | "RESOLVED" | string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface InvestigationStartResponse {
  investigation: {
    id: string;
    incidentId: string;
    tenantId: string;
    agentId: string | null;
    sessionId: string | null;
    status: string;
    startedAt: string;
  };
  session: {
    sessionId: string;
    status: string;
    startedAt: string;
  };
}

export async function fetchIncidents(
  tenantId?: string,
  operatorId?: string,
  status?: string
): Promise<{ items: IncidentItem[]; total: number }> {
  const url = new URL(`${API_BASE}/v1/incidents`);
  if (status) url.searchParams.set("status", status);

  const res = await fetch(url.toString(), {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function startInvestigation(
  incidentId: string,
  agentId?: string,
  tenantId?: string,
  operatorId?: string
): Promise<InvestigationStartResponse> {
  const res = await fetch(`${API_BASE}/v1/investigations/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({ incidentId, agentId })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function fetchInvestigation(
  investigationId: string,
  tenantId?: string,
  operatorId?: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/v1/investigations/${investigationId}`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface CapabilityItem {
  id: string;
  name: string;
  description: string;
  tier: "read" | "mutate" | "deploy";
  category: string;
  provider: "aws" | "gcp" | "azure";
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  category: string;
  builtIn: boolean;
}

export async function fetchCapabilities(tenantId?: string, operatorId?: string): Promise<CapabilityItem[]> {
  const res = await fetch(`${API_BASE}/v1/capabilities`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.capabilities || [];
}

export async function fetchSkills(tenantId?: string, operatorId?: string): Promise<SkillItem[]> {
  const res = await fetch(`${API_BASE}/v1/skills`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.skills || [];
}

export async function connectAgent(
  id: string,
  autoApprove: boolean = true,
  tenantId?: string,
  operatorId?: string
): Promise<{ mcpSseUrl: string; connectorPid: number; status: string }> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({ autoApprove })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface AgentCostBucket {
  agentId: string;
  agentName: string;
  cloudAccountId: string | null;
  cloudAccountLabel: string | null;
  executedMonthlyCostUsd: number;
  pendingMonthlyCostUsd: number;
  approvalCount: number;
}

export interface CloudAccountCostBucket {
  cloudAccountId: string | null;
  cloudAccountLabel: string;
  executedMonthlyCostUsd: number;
  pendingMonthlyCostUsd: number;
  approvalCount: number;
  agentIds: string[];
}

export interface CostSummary {
  totals: {
    executedMonthlyCostUsd: number;
    pendingMonthlyCostUsd: number;
    monthlyBudgetLimitUsd: number;
  };
  byAgent: AgentCostBucket[];
  byCloudAccount: CloudAccountCostBucket[];
  unassignedAgents: { id: string; name: string }[];
}

export async function fetchCostSummary(tenantId?: string, operatorId?: string): Promise<CostSummary> {
  const res = await fetch(`${API_BASE}/v1/costs/summary`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface IamTemplateGroup {
  id: string;
  label: string;
  description: string;
  category: "ecs" | "ec2" | "s3" | "rds" | "cloudwatch" | "logs";
  actions: string[];
  tools: string[];
  note?: string;
}

export async function fetchIamTemplateGroups(tenantId?: string, operatorId?: string): Promise<IamTemplateGroup[]> {
  const res = await fetch(`${API_BASE}/v1/iam-templates`, {
    headers: getAuthHeaders(tenantId, operatorId),
    cache: "no-store"
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.groups || [];
}

export async function buildIamPolicy(
  groupIds: string[],
  tenantId?: string,
  operatorId?: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/v1/iam-templates/build`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({ groupIds })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.policy;
}

export async function testAgent(
  id: string,
  tenantId?: string,
  operatorId?: string
): Promise<{ success: boolean; mcpTools?: string[]; error?: string }> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(tenantId, operatorId)
    },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `HTTP ${res.status}`);
  }

  return res.json();
}

