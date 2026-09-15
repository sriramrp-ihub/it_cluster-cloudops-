import type { AgentId, CredentialId, SessionId, RuntimeCredentialToken } from "@cloudops/shared";

export type RuntimeCredentialStatus = "ACTIVE" | "ROTATED" | "REVOKED" | "EXPIRED";

export interface RuntimeCredentialRecord {
  id: CredentialId;
  agentId: AgentId;
  tenantId: string;
  credentialHash: string;
  salt: string;
  status: RuntimeCredentialStatus;
  issuedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
  replacedByCredentialId: string | null;
  lastUsedAt: Date | null;
}

export interface IssuedRuntimeCredential {
  credentialId: CredentialId;
  secret: RuntimeCredentialToken;
  expiresAt: Date;
}

export type SessionStatus = "REGISTERING" | "CONNECTED" | "DISCONNECTED";

export type DisconnectReason =
  | "CLEAN_DISCONNECT"
  | "CLIENT_DISCONNECT"
  | "HEARTBEAT_TIMEOUT"
  | "REPLACED_BY_NEW_CONNECTION"
  | "SHUTDOWN"
  | "REVOKED"
  | "AUTH_FAILURE";

export interface RuntimeSessionRecord {
  id: SessionId;
  agentId: AgentId;
  tenantId: string;
  credentialId: CredentialId;
  status: SessionStatus;
  disconnectReason: string | null;
  gatewayNodeId: string | null;
  lastHeartbeatAt: Date;
  connectedAt: Date;
  disconnectedAt: Date | null;
}
