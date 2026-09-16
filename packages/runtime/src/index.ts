/**
 * @cloudops/runtime
 * Runtime sessions, credentials, and adapter contracts.
 */
import type { AgentId, SessionId } from "@cloudops/shared";

export * from "./types.js";
export * from "./credentialService.js";
export * from "./sessionService.js";
export * from "./audit.js";
export * from "./agentAdapter.js";
export * from "./mockAgentAdapter.js";
export * from "./hermesAgentAdapter.js";

export interface RuntimeAdapter {
  readonly runtimeType: string;
  readonly protocol: string;

  connect(agentId: AgentId, sessionId: SessionId): Promise<void>;
  disconnect(agentId: AgentId, sessionId: SessionId): Promise<void>;
  isAlive(agentId: AgentId): Promise<boolean>;
  sendTurn(agentId: AgentId, sessionId: SessionId, prompt: string): Promise<AsyncIterable<unknown>>;
}
