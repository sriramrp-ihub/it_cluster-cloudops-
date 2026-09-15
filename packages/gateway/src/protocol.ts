import { z } from "zod";
import type { AgentId, CredentialId, SessionId, RuntimeCredentialToken } from "@cloudops/shared";

export const AuthMessageSchema = z.object({
  type: z.literal("AUTH"),
  authType: z.enum(["BOOTSTRAP", "RUNTIME"]),
  credential: z.string().min(10),
  agentId: z.string().optional(),
  runtimeInfo: z
    .object({
      name: z.string(),
      version: z.string(),
      protocol: z.string().optional()
    })
    .optional()
});

export const HeartbeatMessageSchema = z.object({
  type: z.literal("HEARTBEAT"),
  sessionId: z.string().min(5),
  timestamp: z.number().optional()
});

export const RotateCredentialMessageSchema = z.object({
  type: z.literal("ROTATE_CREDENTIAL"),
  sessionId: z.string().min(5)
});

export const DisconnectMessageSchema = z.object({
  type: z.literal("DISCONNECT"),
  sessionId: z.string().min(5),
  reason: z.string().optional()
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  AuthMessageSchema,
  HeartbeatMessageSchema,
  RotateCredentialMessageSchema,
  DisconnectMessageSchema
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type AuthMessage = z.infer<typeof AuthMessageSchema>;
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;
export type RotateCredentialMessage = z.infer<typeof RotateCredentialMessageSchema>;
export type DisconnectMessage = z.infer<typeof DisconnectMessageSchema>;

export interface AuthSuccessMessage {
  type: "AUTH_SUCCESS";
  sessionId: SessionId;
  agentId: AgentId;
  tenantId: string;
  authType: "BOOTSTRAP" | "RUNTIME";
  runtimeCredential?: {
    credentialId: CredentialId;
    secret: RuntimeCredentialToken;
    expiresAt: string;
  } | undefined;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}

export interface AuthFailedMessage {
  type: "AUTH_FAILED";
  code: string;
  message: string;
}

export interface HeartbeatAckMessage {
  type: "HEARTBEAT_ACK";
  sessionId: SessionId;
  timestamp: number;
}

export interface CredentialRotatedMessage {
  type: "CREDENTIAL_ROTATED";
  newRuntimeCredential: {
    credentialId: CredentialId;
    secret: RuntimeCredentialToken;
    expiresAt: string;
  };
}

export interface SessionTerminatedMessage {
  type: "SESSION_TERMINATED";
  sessionId: SessionId;
  reason: string;
}

export interface ErrorMessage {
  type: "ERROR";
  code: string;
  message: string;
}

export type ServerMessage =
  | AuthSuccessMessage
  | AuthFailedMessage
  | HeartbeatAckMessage
  | CredentialRotatedMessage
  | SessionTerminatedMessage
  | ErrorMessage;
