import WebSocket from "ws";
import { EventEmitter } from "node:events";
import type {
  ClientMessage,
  ServerMessage,
  AuthSuccessMessage,
  AuthFailedMessage,
  HeartbeatAckMessage,
  CredentialRotatedMessage,
  SessionTerminatedMessage,
  ErrorMessage
} from "@cloudops/gateway";
import type { StoredRuntimeCredential } from "./types.js";

export interface GatewayClientOptions {
  wsUrl: string;
  agentId?: string | undefined;
  runtimeInfo?: {
    name: string;
    version: string;
    protocol?: string | undefined;
  } | undefined;
  authTimeoutMs?: number | undefined;
  autoReconnect?: boolean | undefined;
  reconnectIntervalMs?: number | undefined;
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isExplicitDisconnect = false;
  private currentSessionId: string | null = null;
  private storedRuntimeCredential: StoredRuntimeCredential | null = null;

  constructor(public readonly options: GatewayClientOptions) {
    super();
  }

  public get sessionId(): string | null {
    return this.currentSessionId;
  }

  public get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.currentSessionId !== null;
  }

  public get runtimeCredential(): StoredRuntimeCredential | null {
    return this.storedRuntimeCredential ? { ...this.storedRuntimeCredential } : null;
  }

  /**
   * Connect and authenticate to CloudOps Gateway using either a one-time
   * bootstrap credential (co_agent_...) or an active runtime credential (cred_...).
   */
  async connectWithBootstrap(bootstrapCredential: string): Promise<AuthSuccessMessage> {
    this.isExplicitDisconnect = false;
    return this.performHandshake("BOOTSTRAP", bootstrapCredential);
  }

  async connectWithRuntime(runtimeCredentialSecret?: string): Promise<AuthSuccessMessage> {
    this.isExplicitDisconnect = false;
    const secret = runtimeCredentialSecret || this.storedRuntimeCredential?.secret;
    if (!secret) {
      throw new Error("No runtime credential available for authentication");
    }
    return this.performHandshake("RUNTIME", secret);
  }

  private performHandshake(authType: "BOOTSTRAP" | "RUNTIME", credentialSecret: string): Promise<AuthSuccessMessage> {
    return new Promise((resolve, reject) => {
      this.cleanup();

      const ws = new WebSocket(this.options.wsUrl);
      this.ws = ws;

      let authResolved = false;
      const timeoutMs = this.options.authTimeoutMs || 10000;

      const authTimer = setTimeout(() => {
        if (!authResolved) {
          authResolved = true;
          this.cleanup();
          reject(new Error(`Gateway authentication timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      ws.on("open", () => {
        const authMsg: ClientMessage = {
          type: "AUTH",
          authType,
          credential: credentialSecret,
          ...(this.options.agentId ? { agentId: this.options.agentId } : {}),
          ...(this.options.runtimeInfo ? { runtimeInfo: this.options.runtimeInfo } : {})
        };
        ws.send(JSON.stringify(authMsg));
      });

      ws.on("message", (raw: WebSocket.RawData) => {
        try {
          const text = raw.toString("utf-8");
          const msg = JSON.parse(text) as ServerMessage;

          if (!authResolved) {
            if (msg.type === "AUTH_SUCCESS") {
              authResolved = true;
              clearTimeout(authTimer);

              this.currentSessionId = msg.sessionId;
              if (msg.runtimeCredential) {
                this.storedRuntimeCredential = {
                  credentialId: msg.runtimeCredential.credentialId,
                  secret: msg.runtimeCredential.secret,
                  expiresAt: msg.runtimeCredential.expiresAt
                };
              }

              this.startHeartbeat(msg.heartbeatIntervalMs || 15000);
              this.emit("authenticated", msg);
              resolve(msg);
              return;
            }

            if (msg.type === "AUTH_FAILED") {
              authResolved = true;
              clearTimeout(authTimer);
              this.cleanup();
              this.emit("auth_failed", msg);
              reject(new Error(`Authentication failed [${msg.code}]: ${msg.message}`));
              return;
            }
          }

          this.handleServerMessage(msg);
        } catch (err: any) {
          this.emit("error", new Error(`Failed to parse incoming gateway frame: ${err.message}`));
        }
      });

      ws.on("close", (code, reason) => {
        const reasonStr = reason?.toString() || "closed";
        this.cleanup();
        this.emit("close", { code, reason: reasonStr });

        if (!authResolved) {
          authResolved = true;
          clearTimeout(authTimer);
          reject(new Error(`WebSocket closed before authentication completed (code: ${code})`));
        } else if (!this.isExplicitDisconnect && this.options.autoReconnect && this.storedRuntimeCredential) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err) => {
        this.emit("error", err);
        if (!authResolved) {
          authResolved = true;
          clearTimeout(authTimer);
          reject(err);
        }
      });
    });
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "HEARTBEAT_ACK":
        this.emit("heartbeat_ack", msg);
        break;

      case "CREDENTIAL_ROTATED":
        this.storedRuntimeCredential = {
          credentialId: msg.newRuntimeCredential.credentialId,
          secret: msg.newRuntimeCredential.secret,
          expiresAt: msg.newRuntimeCredential.expiresAt
        };
        this.emit("credential_rotated", msg);
        break;

      case "SESSION_TERMINATED":
        this.emit("session_terminated", msg);
        this.cleanup();
        break;

      case "ERROR":
        this.emit("server_error", msg);
        break;

      default:
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSessionId) {
        const ping: ClientMessage = {
          type: "HEARTBEAT",
          sessionId: this.currentSessionId,
          timestamp: Date.now()
        };
        this.ws.send(JSON.stringify(ping));
      }
    }, intervalMs);
  }

  /**
   * Request atomic credential rotation over active Gateway connection.
   */
  async rotateCredential(): Promise<StoredRuntimeCredential> {
    if (!this.isConnected || !this.currentSessionId || !this.ws) {
      throw new Error("Cannot rotate credential: Gateway connection is not active");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for credential rotation acknowledgment"));
      }, 5000);

      const onRotated = (msg: CredentialRotatedMessage) => {
        clearTimeout(timeout);
        this.off("credential_rotated", onRotated);
        resolve({
          credentialId: msg.newRuntimeCredential.credentialId,
          secret: msg.newRuntimeCredential.secret,
          expiresAt: msg.newRuntimeCredential.expiresAt
        });
      };

      this.once("credential_rotated", onRotated);

      const rotateMsg: ClientMessage = {
        type: "ROTATE_CREDENTIAL",
        sessionId: this.currentSessionId!
      };
      if (this.ws) {
        this.ws.send(JSON.stringify(rotateMsg));
      } else {
        clearTimeout(timeout);
        this.off("credential_rotated", onRotated);
        reject(new Error("WebSocket is not connected"));
      }
    });
  }

  /**
   * Explicitly disconnect from the Gateway.
   */
  async disconnect(reason: string = "CLIENT_DISCONNECT"): Promise<void> {
    this.isExplicitDisconnect = true;

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSessionId) {
      const disconnectMsg: ClientMessage = {
        type: "DISCONNECT",
        sessionId: this.currentSessionId,
        reason
      };
      await new Promise<void>((resolve) => {
        const socket = this.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) return resolve();

        const timer = setTimeout(resolve, 1000);
        socket.once("close", () => {
          clearTimeout(timer);
          resolve();
        });

        try {
          socket.send(JSON.stringify(disconnectMsg));
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }

    this.cleanup();
  }

  private scheduleReconnect(): void {
    const delay = this.options.reconnectIntervalMs || 3000;
    this.emit("reconnecting", { attemptDelayMs: delay });

    setTimeout(async () => {
      if (this.isExplicitDisconnect || this.isConnected) return;
      try {
        await this.connectWithRuntime();
        this.emit("reconnected");
      } catch (err: any) {
        this.emit("reconnect_failed", err);
        if (this.options.autoReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.currentSessionId = null;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        // Ignore
      }
      this.ws = null;
    }
  }
}
