import type { WebSocket } from "ws";
import {
  RuntimeCredentialService,
  RuntimeSessionService,
  recordAuditEvent
} from "@cloudops/runtime";
import { GatewayAuthenticator } from "./authenticator.js";
import { GatewayConnectionManager, type ConnectedSocketMetadata } from "./connectionManager.js";
import { DefenseClawClient, generateTraceparent, isValidTraceparent } from "./defenseClawClient.js";
import {
  ClientMessageSchema,
  type AuthSuccessMessage,
  type AuthFailedMessage,
  type HeartbeatAckMessage,
  type CredentialRotatedMessage,
  type ErrorMessage,
  type ServerMessage,
  type CapabilityRequestMessage,
  type CapabilityResponseMessage
} from "./protocol.js";

export interface GatewayHandlerOptions {
  authTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  gatewayNodeId?: string;
  defenseClaw?: DefenseClawClient;
}

export class GatewayHandler {
  private readonly authTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly gatewayNodeId: string;
  public readonly defenseClaw: DefenseClawClient;

  constructor(
    public readonly authenticator: GatewayAuthenticator = new GatewayAuthenticator(),
    public readonly connectionManager: GatewayConnectionManager = new GatewayConnectionManager(),
    public readonly credentialService: RuntimeCredentialService = new RuntimeCredentialService(),
    public readonly sessionService: RuntimeSessionService = new RuntimeSessionService(),
    options: GatewayHandlerOptions = {}
  ) {
    this.authTimeoutMs = options.authTimeoutMs || 10000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 45000;
    this.gatewayNodeId = options.gatewayNodeId || "gateway-node-1";
    this.defenseClaw = options.defenseClaw || new DefenseClawClient();
  }

  /**
   * Handle an incoming WebSocket connection.
   */
  handleConnection(ws: WebSocket): void {
    let isAuthenticated = false;

    // Strict handshake timeout: must authenticate within authTimeoutMs
    const authTimer = setTimeout(() => {
      if (!isAuthenticated && ws.readyState === ws.OPEN) {
        const timeoutMsg: AuthFailedMessage = {
          type: "AUTH_FAILED",
          code: "AUTHENTICATION_TIMEOUT",
          message: "Authentication handshake timed out"
        };
        try {
          ws.send(JSON.stringify(timeoutMsg));
          ws.close(1008, "Authentication timeout");
        } catch {
          // Ignore
        }
      }
    }, this.authTimeoutMs);

    ws.on("message", async (data: Buffer | string) => {
      try {
        const rawString = typeof data === "string" ? data : data.toString("utf-8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawString);
        } catch {
          const errMsg: ErrorMessage = {
            type: "ERROR",
            code: "MALFORMED_JSON",
            message: "Incoming message is not valid JSON"
          };
          ws.send(JSON.stringify(errMsg));
          return;
        }

        const parseResult = ClientMessageSchema.safeParse(parsed);
        if (!parseResult.success) {
          const errMsg: ErrorMessage = {
            type: "ERROR",
            code: "MALFORMED_MESSAGE",
            message: parseResult.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
          };
          ws.send(JSON.stringify(errMsg));
          return;
        }

        const msg = parseResult.data;

        // 1. Handshake Phase: Expect AUTH first
        if (!isAuthenticated) {
          if (msg.type !== "AUTH") {
            const errMsg: ErrorMessage = {
              type: "ERROR",
              code: "UNAUTHENTICATED",
              message: "First message must be an AUTH message"
            };
            ws.send(JSON.stringify(errMsg));
            ws.close(1008, "Unauthenticated");
            return;
          }

          try {
            const authResult = await this.authenticator.authenticate(msg, this.gatewayNodeId);
            clearTimeout(authTimer);
            isAuthenticated = true;

            // Register session in ConnectionManager (which also closes any previous session cleanly)
            this.connectionManager.registerSession(
              authResult.session,
              ws,
              authResult.previousSessionId,
              authResult.grantedCapabilities,
              authResult.agentName
            );

            const successMsg: AuthSuccessMessage = {
              type: "AUTH_SUCCESS",
              sessionId: authResult.session.id,
              agentId: authResult.session.agentId,
              tenantId: authResult.session.tenantId,
              authType: authResult.authType,
              ...(authResult.runtimeCredential ? { runtimeCredential: authResult.runtimeCredential } : {}),
              heartbeatIntervalMs: this.heartbeatIntervalMs,
              heartbeatTimeoutMs: this.heartbeatTimeoutMs
            };

            ws.send(JSON.stringify(successMsg));
            return;
          } catch (authErr: any) {
            clearTimeout(authTimer);
            const failMsg: AuthFailedMessage = {
              type: "AUTH_FAILED",
              code: authErr?.code || "AUTHENTICATION_FAILED",
              message: authErr?.message || "Authentication failed"
            };
            ws.send(JSON.stringify(failMsg));
            ws.close(1008, "Authentication failed");
            return;
          }
        }

        // 2. Authenticated Session Phase
        const meta = this.connectionManager.getMetadata(ws);
        if (!meta) {
          ws.close(1008, "Session metadata missing");
          return;
        }

        switch (msg.type) {
          case "HEARTBEAT": {
            if (msg.sessionId !== meta.sessionId) {
              const errMsg: ErrorMessage = {
                type: "ERROR",
                code: "SESSION_MISMATCH",
                message: "Heartbeat sessionId does not match active connection session"
              };
              ws.send(JSON.stringify(errMsg));
              return;
            }

            await this.sessionService.recordHeartbeat(meta.sessionId);
            this.connectionManager.updateHeartbeat(ws);

            const ack: HeartbeatAckMessage = {
              type: "HEARTBEAT_ACK",
              sessionId: meta.sessionId,
              timestamp: Date.now()
            };
            ws.send(JSON.stringify(ack));
            break;
          }

          case "ROTATE_CREDENTIAL": {
            if (msg.sessionId !== meta.sessionId) {
              const errMsg: ErrorMessage = {
                type: "ERROR",
                code: "SESSION_MISMATCH",
                message: "Rotate credential sessionId does not match active connection session"
              };
              ws.send(JSON.stringify(errMsg));
              return;
            }

            try {
              const newCred = await this.credentialService.rotateCredential(
                meta.tenantId,
                meta.agentId,
                meta.credentialId
              );

              // Update metadata with new credential ID
              meta.credentialId = newCred.credentialId;

              const rotatedMsg: CredentialRotatedMessage = {
                type: "CREDENTIAL_ROTATED",
                newRuntimeCredential: {
                  credentialId: newCred.credentialId,
                  secret: newCred.secret,
                  expiresAt: newCred.expiresAt.toISOString()
                }
              };
              ws.send(JSON.stringify(rotatedMsg));
            } catch (rotErr: any) {
              const errMsg: ErrorMessage = {
                type: "ERROR",
                code: rotErr?.code || "ROTATION_FAILED",
                message: rotErr?.message || "Failed to rotate credential"
              };
              ws.send(JSON.stringify(errMsg));
            }
            break;
          }

          case "DISCONNECT": {
            this.connectionManager.unregisterSocket(ws);
            await this.sessionService.terminateSession(meta.sessionId, "CLIENT_DISCONNECT");
            ws.close(1000, "Client initiated disconnect");
            break;
          }

          case "AUTH": {
            // Already authenticated
            const errMsg: ErrorMessage = {
              type: "ERROR",
              code: "ALREADY_AUTHENTICATED",
              message: "Connection is already authenticated"
            };
            ws.send(JSON.stringify(errMsg));
            break;
          }

          case "CAPABILITY_REQUEST": {
            await this.handleCapabilityRequest(ws, meta, msg);
            break;
          }
        }
      } catch (err: any) {
        const errMsg: ErrorMessage = {
          type: "ERROR",
          code: "INTERNAL_ERROR",
          message: "Internal gateway processing error"
        };
        try {
          ws.send(JSON.stringify(errMsg));
        } catch {
          // Ignore
        }
      }
    });

    ws.on("close", async () => {
      clearTimeout(authTimer);
      const meta = this.connectionManager.unregisterSocket(ws);
      if (meta) {
        await this.sessionService.terminateSession(meta.sessionId, "CLIENT_DISCONNECT");
      }
    });

    ws.on("error", async () => {
      clearTimeout(authTimer);
      const meta = this.connectionManager.unregisterSocket(ws);
      if (meta) {
        await this.sessionService.terminateSession(meta.sessionId, "CLIENT_DISCONNECT");
      }
    });
  }

  private async handleCapabilityRequest(
    ws: WebSocket,
    meta: ConnectedSocketMetadata,
    msg: CapabilityRequestMessage
  ): Promise<void> {
    const traceparent = isValidTraceparent(msg.traceparent)
      ? msg.traceparent!
      : generateTraceparent();

    const evalResult = await this.defenseClaw.evaluate({
      correlationId: msg.requestId,
      agentId: meta.agentId,
      tenantId: meta.tenantId,
      capability: msg.capability,
      arguments: msg.arguments || {},
      grantedCapabilities: meta.grantedCapabilities,
      traceparent,
      approvalGranted: Boolean(msg.approvalId),
      budgetOverride: msg.budgetOverride
    });

    if (evalResult.verdict === "BLOCK") {
      await recordAuditEvent({
        tenantId: meta.tenantId,
        eventType: "CAPABILITY_BLOCKED",
        actorType: "AGENT",
        actorId: meta.agentId,
        agentId: meta.agentId,
        payload: {
          capability: msg.capability,
          ruleId: evalResult.ruleId,
          reason: evalResult.reason,
          traceparent
        }
      }).catch(() => {});

      const response: CapabilityResponseMessage = {
        type: "CAPABILITY_RESPONSE",
        requestId: msg.requestId,
        status: "BLOCKED",
        error: {
          code: evalResult.ruleId === "DEFENSECLAW_UNAVAILABLE" ? "DEFENSECLAW_UNAVAILABLE" : "POLICY_VIOLATION",
          message: evalResult.reason || "Blocked by security policy",
          ruleId: evalResult.ruleId,
          verdict: "BLOCK"
        },
        traceparent
      };
      ws.send(JSON.stringify(response));
      return;
    }

    if (evalResult.verdict === "APPROVAL_REQUIRED") {
      await recordAuditEvent({
        tenantId: meta.tenantId,
        eventType: "CAPABILITY_APPROVAL_REQUIRED",
        actorType: "AGENT",
        actorId: meta.agentId,
        agentId: meta.agentId,
        payload: {
          capability: msg.capability,
          ruleId: evalResult.ruleId,
          reason: evalResult.reason,
          traceparent
        }
      }).catch(() => {});

      const response: CapabilityResponseMessage = {
        type: "CAPABILITY_RESPONSE",
        requestId: msg.requestId,
        status: "APPROVAL_REQUIRED",
        error: {
          code: "APPROVAL_REQUIRED",
          message: evalResult.reason || "Approval required for capability execution",
          ruleId: evalResult.ruleId,
          verdict: "APPROVAL_REQUIRED"
        },
        traceparent
      };
      ws.send(JSON.stringify(response));
      return;
    }

    // Verdict is ALLOW
    await recordAuditEvent({
      tenantId: meta.tenantId,
      eventType: "CAPABILITY_INVOKED",
      actorType: "AGENT",
      actorId: meta.agentId,
      agentId: meta.agentId,
      payload: {
        capability: msg.capability,
        arguments: msg.arguments,
        traceparent
      }
    }).catch(() => {});

    const response: CapabilityResponseMessage = {
      type: "CAPABILITY_RESPONSE",
      requestId: msg.requestId,
      status: "SUCCESS",
      data: {
        executed: true,
        capability: msg.capability,
        arguments: msg.arguments
      },
      traceparent
    };
    ws.send(JSON.stringify(response));
  }
}
