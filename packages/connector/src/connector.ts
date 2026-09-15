import { EventEmitter } from "node:events";
import type {
  ConnectorConfig,
  ConnectorState,
  ConnectorStatus,
  StoredRuntimeCredential
} from "./types.js";
import { OnboardingClient } from "./onboardingClient.js";
import { GatewayClient } from "./gatewayClient.js";
import type { AgentId, SessionId } from "@cloudops/shared";

export class CloudOpsConnector extends EventEmitter {
  private _state: ConnectorState = "INITIALIZING";
  private onboardingClient: OnboardingClient;
  private gatewayClient: GatewayClient | null = null;

  private tenantId?: string | undefined;
  private agentId?: AgentId | undefined;
  private joinRequestId?: string | undefined;
  private rawBootstrapCredential?: string | undefined;
  private lastHeartbeatAck?: number | undefined;
  private lastError?: string | undefined;

  constructor(public readonly config: ConnectorConfig) {
    super();
    this.onboardingClient = new OnboardingClient(config.apiBaseUrl);
  }

  public get state(): ConnectorState {
    return this._state;
  }

  private setState(newState: ConnectorState): void {
    this._state = newState;
    this.emit("state_changed", newState);
  }

  public getStatus(): ConnectorStatus {
    return {
      state: this._state,
      tenantId: this.tenantId,
      agentId: this.agentId,
      joinRequestId: this.joinRequestId,
      sessionId: this.gatewayClient?.sessionId as SessionId | undefined,
      hasBootstrapCredential: Boolean(this.rawBootstrapCredential),
      hasRuntimeCredential: Boolean(this.gatewayClient?.runtimeCredential),
      runtimeCredentialExpiresAt: this.gatewayClient?.runtimeCredential?.expiresAt,
      lastHeartbeatAck: this.lastHeartbeatAck,
      error: this.lastError
    };
  }

  /**
   * Complete the full onboarding lifecycle and establish a persistent Gateway session:
   * 1. Discover manifest
   * 2. Submit join request
   * 3. Await human operator approval
   * 4. Claim bootstrap credential
   * 5. Establish Gateway WebSocket connection with BOOTSTRAP auth
   * 6. Retain runtime credential & maintain heartbeats (CONNECTED)
   */
  async startOnboardingAndConnect(): Promise<ConnectorStatus> {
    try {
      // 1. Discover Manifest
      this.setState("DISCOVERING_MANIFEST");
      const manifest = await this.onboardingClient.getManifest(this.config.inviteToken);
      this.tenantId = manifest.tenantId;
      this.emit("manifest_discovered", { tenantId: manifest.tenantId, lifecycleState: manifest.lifecycleState });

      // 2. Submit Join Request if not already submitted
      let currentJoinId = manifest.joinRequestId;
      if (!currentJoinId || manifest.lifecycleState === "INVITE_ACTIVE") {
        this.setState("SUBMITTING_JOIN");
        const joinResult = await this.onboardingClient.submitJoin(this.config.inviteToken, {
          agent: {
            name: this.config.agentName,
            type: this.config.agentType
          },
          runtime: this.config.runtimeInfo || {
            name: `${this.config.agentType}-runtime`,
            version: "1.0.0",
            protocol: "acp"
          },
          requestedCapabilities: this.config.requestedCapabilities || []
        });
        currentJoinId = joinResult.joinRequestId;
        this.joinRequestId = currentJoinId;
        this.emit("join_submitted", { joinRequestId: currentJoinId });
      } else {
        this.joinRequestId = currentJoinId;
      }

      // 3. Await Operator Approval
      let approvedManifest = manifest;
      if (manifest.lifecycleState !== "APPROVED") {
        this.setState("AWAITING_APPROVAL");
        approvedManifest = await this.onboardingClient.pollForApproval(this.config.inviteToken, {
          intervalMs: this.config.pollIntervalMs || 2000,
          timeoutMs: this.config.pollTimeoutMs || 120000,
          onPoll: (m) => this.emit("approval_poll", { state: m.lifecycleState })
        });
      }

      this.agentId = (approvedManifest.agentId || this.agentId) as AgentId | undefined;
      this.emit("approval_granted", { agentId: this.agentId });

      // 4. Claim One-Time Bootstrap Credential
      this.setState("CLAIMING_CREDENTIAL");
      const claimResult = await this.onboardingClient.claimCredential(
        this.config.inviteToken,
        this.joinRequestId!
      );

      this.agentId = claimResult.agentId;
      this.rawBootstrapCredential = claimResult.claimCredential;
      this.emit("credential_claimed", { agentId: claimResult.agentId });

      // 5. Connect to CloudOps Gateway with Bootstrap Credential
      this.setState("CONNECTING_GATEWAY");
      const wsUrl = `${this.config.wsBaseUrl.replace(/\/+$/, "")}/v1/gateway/ws`;

      this.gatewayClient = new GatewayClient({
        wsUrl,
        agentId: this.agentId,
        runtimeInfo: this.config.runtimeInfo || {
          name: `${this.config.agentType}-runtime`,
          version: "1.0.0",
          protocol: "acp"
        },
        autoReconnect: this.config.autoReconnect !== false,
        reconnectIntervalMs: this.config.reconnectIntervalMs || 3000
      });

      this.setupGatewayListeners();

      const authSuccess = await this.gatewayClient.connectWithBootstrap(this.rawBootstrapCredential);

      // Successfully connected!
      this.setState("CONNECTED");
      this.emit("connected", {
        sessionId: authSuccess.sessionId,
        agentId: authSuccess.agentId,
        tenantId: authSuccess.tenantId
      });

      return this.getStatus();
    } catch (err: any) {
      this.lastError = err.message;
      this.setState("FAILED");
      this.emit("error", err);
      throw err;
    }
  }

  private setupGatewayListeners(): void {
    if (!this.gatewayClient) return;

    this.gatewayClient.on("heartbeat_ack", (msg) => {
      this.lastHeartbeatAck = msg.timestamp;
      this.emit("heartbeat_ack", msg);
    });

    this.gatewayClient.on("credential_rotated", (msg) => {
      this.emit("credential_rotated", msg);
    });

    this.gatewayClient.on("reconnecting", (data) => {
      this.setState("RECONNECTING");
      this.emit("reconnecting", data);
    });

    this.gatewayClient.on("reconnected", () => {
      this.setState("CONNECTED");
      this.emit("reconnected");
    });

    this.gatewayClient.on("close", (data) => {
      if (this._state !== "RECONNECTING") {
        this.setState("DISCONNECTED");
      }
      this.emit("disconnected", data);
    });

    this.gatewayClient.on("error", (err) => {
      this.lastError = err.message;
      this.emit("gateway_error", err);
    });
  }

  /**
   * Request atomic runtime credential rotation.
   */
  async rotateCredential(): Promise<StoredRuntimeCredential> {
    if (!this.gatewayClient) {
      throw new Error("Cannot rotate credential: Gateway client not initialized");
    }
    return this.gatewayClient.rotateCredential();
  }

  /**
   * Disconnect cleanly from the Gateway.
   */
  async disconnect(reason: string = "CLIENT_DISCONNECT"): Promise<void> {
    if (this.gatewayClient) {
      await this.gatewayClient.disconnect(reason);
    }
    this.setState("DISCONNECTED");
  }

  /**
   * Reconnect to the Gateway using the stored runtime credential.
   */
  async reconnect(): Promise<void> {
    if (!this.gatewayClient) {
      throw new Error("Cannot reconnect: Gateway client not initialized");
    }
    this.setState("RECONNECTING");
    await this.gatewayClient.connectWithRuntime();
    this.setState("CONNECTED");
  }
}
