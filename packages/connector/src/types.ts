import type {
  AgentId,
  CredentialId,
  SessionId,
  RuntimeCredentialToken,
  ClaimCredential
} from "@cloudops/shared";
import type { OnboardingManifest } from "@cloudops/onboarding";

export type ConnectorState =
  | "INITIALIZING"
  | "DISCOVERING_MANIFEST"
  | "SUBMITTING_JOIN"
  | "AWAITING_APPROVAL"
  | "CLAIMING_CREDENTIAL"
  | "CONNECTING_GATEWAY"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTED"
  | "FAILED";

export interface ConnectorConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  inviteToken: string;
  agentName: string;
  agentType: "hermes" | "openclaw" | "custom" | string;
  runtimeInfo?: {
    name: string;
    version: string;
    protocol?: string | undefined;
  } | undefined;
  requestedCapabilities?: string[] | undefined;
  pollIntervalMs?: number | undefined;
  pollTimeoutMs?: number | undefined;
  autoReconnect?: boolean | undefined;
  reconnectIntervalMs?: number | undefined;
}

export interface StoredRuntimeCredential {
  credentialId: CredentialId;
  secret: RuntimeCredentialToken;
  expiresAt: string;
}

export interface ConnectorStatus {
  state: ConnectorState;
  tenantId?: string | undefined;
  agentId?: AgentId | undefined;
  joinRequestId?: string | undefined;
  sessionId?: SessionId | undefined;
  hasBootstrapCredential: boolean;
  hasRuntimeCredential: boolean;
  runtimeCredentialExpiresAt?: string | undefined;
  lastHeartbeatAck?: number | undefined;
  error?: string | undefined;
}

