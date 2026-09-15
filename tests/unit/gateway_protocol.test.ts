import { describe, it, expect } from "vitest";
import {
  ClientMessageSchema,
  AuthMessageSchema,
  HeartbeatMessageSchema,
  RotateCredentialMessageSchema,
  DisconnectMessageSchema
} from "../../packages/gateway/src/protocol.js";

describe("Phase 3: Gateway Protocol Unit Tests", () => {
  it("validates bootstrap auth message schema", () => {
    const valid = {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: "co_agent_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      agentId: "ag_12345678-1234-1234-1234-1234567890ab",
      runtimeInfo: {
        name: "hermes-agent",
        version: "0.19.0"
      }
    };

    const parsed = ClientMessageSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("AUTH");
      expect(parsed.data.authType).toBe("BOOTSTRAP");
    }
  });

  it("validates runtime auth message schema", () => {
    const valid = {
      type: "AUTH",
      authType: "RUNTIME",
      credential: "cred_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      agentId: "ag_12345678-1234-1234-1234-1234567890ab"
    };

    const parsed = ClientMessageSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects auth message with invalid authType", () => {
    const invalid = {
      type: "AUTH",
      authType: "MAGIC_TOKEN",
      credential: "cred_1234567890"
    };

    const parsed = ClientMessageSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("validates heartbeat message schema", () => {
    const valid = {
      type: "HEARTBEAT",
      sessionId: "sess_12345678-1234-1234-1234-1234567890ab",
      timestamp: Date.now()
    };

    const parsed = ClientMessageSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates rotate credential message schema", () => {
    const valid = {
      type: "ROTATE_CREDENTIAL",
      sessionId: "sess_12345678-1234-1234-1234-1234567890ab"
    };

    const parsed = ClientMessageSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates disconnect message schema", () => {
    const valid = {
      type: "DISCONNECT",
      sessionId: "sess_12345678-1234-1234-1234-1234567890ab",
      reason: "CLEAN_DISCONNECT"
    };

    const parsed = ClientMessageSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown message type", () => {
    const unknown = {
      type: "SEND_TURN",
      prompt: "Execute terraform"
    };

    const parsed = ClientMessageSchema.safeParse(unknown);
    expect(parsed.success).toBe(false);
  });
});
