import { describe, it, expect } from "vitest";
import {
  type AgentAdapter,
  type AgentSession,
  type AgentToolCall,
  type AgentToolResult,
  MockAgentAdapter
} from "@cloudops/runtime";

describe("AgentAdapter Generic Contract (CO-002)", () => {
  // Factory that returns the interface rather than the concrete class
  function createAgentAdapter(): AgentAdapter {
    return new MockAgentAdapter();
  }

  it("drives an entire agent session typed strictly against AgentAdapter interface", async () => {
    const adapter: AgentAdapter = createAgentAdapter();

    expect(adapter.adapterType).toBeDefined();
    expect(["acp", "mcp"]).toContain(adapter.protocol);

    // 1. Start session
    const session: AgentSession = await adapter.start({
      tenantId: "ten_contract_test",
      agentId: "ag_contract_test",
      incidentContext: {
        incidentId: "inc_contract_test_001",
        provider: "AWS",
        accountId: "265766933076",
        region: "us-east-1",
        service: "checkout-service",
        resourceId: "arn:aws:ecs:us-east-1:265766933076:service/test/checkout",
        severity: "HIGH",
        title: "Contract Test Alert",
        alertDescription: "Test alert for contract validation"
      }
    });


    expect(session.sessionId).toMatch(/^sess_/);
    expect(session.status).toBe("ACTIVE");

    // 2. Attach tool handler through generic interface
    let toolCallReceived: AgentToolCall | null = null;
    const unsubscribeTool = adapter.onToolCall(session.sessionId, async (call) => {
      toolCallReceived = call;
      return {
        callId: call.callId,
        status: "SUCCESS",
        data: { healthy: true }
      };
    });

    // 3. Attach event listener through generic interface
    const eventsReceived: string[] = [];
    const unsubscribeEvent = adapter.onEvent(session.sessionId, (e) => {
      eventsReceived.push(e.type);
    });

    // 4. Terminate through generic interface
    await adapter.terminate(session.sessionId, "NORMAL_COMPLETION");
    expect(eventsReceived).toContain("STATUS");

    const finishedSession = adapter.getSession(session.sessionId);
    expect(finishedSession?.status).toBe("TERMINATED");
    expect(finishedSession?.disconnectReason).toBe("NORMAL_COMPLETION");

    unsubscribeTool();
    unsubscribeEvent();
  });
});
