import type { WebSocket } from "ws";
import type { AgentId, CredentialId, SessionId } from "@cloudops/shared";
import { RuntimeSessionService, type RuntimeSessionRecord } from "@cloudops/runtime";
import type { ServerMessage, SessionTerminatedMessage } from "./protocol.js";

export interface ConnectedSocketMetadata {
  sessionId: SessionId;
  agentId: AgentId;
  tenantId: string;
  credentialId: CredentialId;
  lastHeartbeatTime: number;
  agentName?: string | undefined;
  grantedCapabilities?: string[] | undefined;
}

export class GatewayConnectionManager {
  private readonly sessionToSocket = new Map<SessionId, WebSocket>();
  private readonly socketToMetadata = new Map<WebSocket, ConnectedSocketMetadata>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly sessionService: RuntimeSessionService = new RuntimeSessionService()) {}

  /**
   * Register an authenticated WebSocket session.
   * If a previousSessionId is specified, the previous socket is terminated cleanly.
   */
  registerSession(
    session: RuntimeSessionRecord,
    ws: WebSocket,
    previousSessionId?: SessionId | undefined,
    grantedCapabilities?: string[] | undefined,
    agentName?: string | undefined
  ): void {
    // 1. If this connection replaced a previous session, terminate previous socket
    if (previousSessionId) {
      const oldSocket = this.sessionToSocket.get(previousSessionId);
      if (oldSocket && oldSocket !== ws && oldSocket.readyState === oldSocket.OPEN) {
        const termMsg: SessionTerminatedMessage = {
          type: "SESSION_TERMINATED",
          sessionId: previousSessionId,
          reason: "REPLACED_BY_NEW_CONNECTION"
        };
        try {
          oldSocket.send(JSON.stringify(termMsg));
          oldSocket.close(1000, "Replaced by new connection");
        } catch {
          // Socket error during close is ignored
        }
      }
      this.sessionToSocket.delete(previousSessionId);
    }

    // 2. Bind new session
    this.sessionToSocket.set(session.id, ws);
    this.socketToMetadata.set(ws, {
      sessionId: session.id,
      agentId: session.agentId,
      tenantId: session.tenantId,
      credentialId: session.credentialId,
      lastHeartbeatTime: Date.now(),
      agentName,
      grantedCapabilities: grantedCapabilities || []
    });
  }

  /**
   * Update heartbeat timestamp for a connected socket.
   */
  updateHeartbeat(ws: WebSocket): boolean {
    const meta = this.socketToMetadata.get(ws);
    if (!meta) {
      return false;
    }
    meta.lastHeartbeatTime = Date.now();
    return true;
  }

  /**
   * Get metadata for a connected socket.
   */
  getMetadata(ws: WebSocket): ConnectedSocketMetadata | undefined {
    return this.socketToMetadata.get(ws);
  }

  /**
   * Unregister a socket on disconnect.
   */
  unregisterSocket(ws: WebSocket): ConnectedSocketMetadata | undefined {
    const meta = this.socketToMetadata.get(ws);
    if (meta) {
      this.sessionToSocket.delete(meta.sessionId);
      this.socketToMetadata.delete(ws);
    }
    return meta;
  }

  /**
   * Start background heartbeat liveness monitor.
   */
  startHeartbeatMonitor(intervalMs: number = 10000, timeoutMs: number = 30000): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(async () => {
      const now = Date.now();

      // Check local sockets
      for (const [ws, meta] of this.socketToMetadata.entries()) {
        if (now - meta.lastHeartbeatTime > timeoutMs) {
          if (ws.readyState === ws.OPEN) {
            const termMsg: SessionTerminatedMessage = {
              type: "SESSION_TERMINATED",
              sessionId: meta.sessionId,
              reason: "HEARTBEAT_TIMEOUT"
            };
            try {
              ws.send(JSON.stringify(termMsg));
              ws.close(1000, "Heartbeat timeout");
            } catch {
              // Ignore socket send errors on timeout
            }
          }
          this.unregisterSocket(ws);
          await this.sessionService.terminateSession(meta.sessionId, "HEARTBEAT_TIMEOUT", "heartbeat-monitor");
        }
      }

      // Sweep any stale sessions in the database across replicas
      await this.sessionService.sweepStaleSessions(timeoutMs).catch(() => {});
    }, intervalMs);
  }

  /**
   * Send a JSON message to a connected session.
   */
  sendMessage(sessionId: SessionId, message: ServerMessage): boolean {
    const ws = this.sessionToSocket.get(sessionId);
    if (!ws || ws.readyState !== ws.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Stop connection manager and terminate all active sessions during graceful shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const closePromises: Promise<void>[] = [];

    for (const [ws, meta] of this.socketToMetadata.entries()) {
      if (ws.readyState === ws.OPEN) {
        const termMsg: SessionTerminatedMessage = {
          type: "SESSION_TERMINATED",
          sessionId: meta.sessionId,
          reason: "SHUTDOWN"
        };
        try {
          ws.send(JSON.stringify(termMsg));
          ws.close(1001, "Server shutting down");
        } catch {
          // Ignore
        }
      }
      closePromises.push(
        this.sessionService.terminateSession(meta.sessionId, "SHUTDOWN", "shutdown-hook").then(() => {})
      );
    }

    this.sessionToSocket.clear();
    this.socketToMetadata.clear();

    await Promise.allSettled(closePromises);
  }
}
