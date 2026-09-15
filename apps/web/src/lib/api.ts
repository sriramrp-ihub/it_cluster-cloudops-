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
  createdAt: string;
  updatedAt: string;
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
    headers: getAuthHeaders(tenantId, operatorId)
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
