import { describe, it, expect, vi } from "vitest";
import { OnboardingClient } from "@cloudops/connector";
import { GatewayClient } from "@cloudops/connector";

describe("CloudOps Connector Unit Tests", () => {
  describe("OnboardingClient", () => {
    it("retrieves and parses onboarding manifest correctly", async () => {
      const mockManifest = {
        onboardingVersion: "1.0",
        tenantId: "ten_test123",
        inviteState: "ACTIVE",
        lifecycleState: "INVITE_ACTIVE",
        nextAction: "SUBMIT_JOIN_REQUEST",
        supportedAgentTypes: ["hermes", "openclaw", "custom"],
        endpoints: { join: "/v1/onboarding/tok/join", claim: "/v1/onboarding/claim" },
        joinSchema: { type: "object", required: [], properties: {} }
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest
      } as any);

      const client = new OnboardingClient("http://localhost:3000");
      const manifest = await client.getManifest("co_inv_testtoken");

      expect(fetchSpy).toHaveBeenCalledWith("http://localhost:3000/v1/onboarding/co_inv_testtoken", expect.anything());
      expect(manifest.tenantId).toBe("ten_test123");
      expect(manifest.lifecycleState).toBe("INVITE_ACTIVE");

      fetchSpy.mockRestore();
    });

    it("submits declarative join request", async () => {
      const mockResponse = {
        joinRequestId: "jr_test123",
        status: "PENDING_APPROVAL",
        tenantId: "ten_test123",
        requestedCapabilities: ["aws.ecs.describe_clusters"]
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as any);

      const client = new OnboardingClient("http://localhost:3000");
      const res = await client.submitJoin("co_inv_testtoken", {
        agent: { name: "test-agent", type: "hermes" },
        runtime: { name: "hermes-runtime", version: "1.0.0" },
        requestedCapabilities: ["aws.ecs.describe_clusters"]
      });

      expect(res.joinRequestId).toBe("jr_test123");
      expect(res.status).toBe("PENDING_APPROVAL");

      fetchSpy.mockRestore();
    });

    it("polls for approval until APPROVED state is returned", async () => {
      const manifestPending = {
        onboardingVersion: "1.0",
        tenantId: "ten_test123",
        inviteState: "ACTIVE",
        lifecycleState: "PENDING_APPROVAL",
        nextAction: "WAIT_FOR_APPROVAL"
      };

      const manifestApproved = {
        onboardingVersion: "1.0",
        tenantId: "ten_test123",
        inviteState: "ACTIVE",
        lifecycleState: "APPROVED",
        nextAction: "CLAIM_CREDENTIAL",
        agentId: "ag_testagent123"
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: true, json: async () => manifestPending } as any)
        .mockResolvedValueOnce({ ok: true, json: async () => manifestApproved } as any);

      const client = new OnboardingClient("http://localhost:3000");
      const result = await client.pollForApproval("co_inv_testtoken", { intervalMs: 10, timeoutMs: 1000 });

      expect(result.lifecycleState).toBe("APPROVED");
      expect(result.agentId).toBe("ag_testagent123");

      fetchSpy.mockRestore();
    });

    it("claims bootstrap credential successfully", async () => {
      const mockClaim = {
        agentId: "ag_testagent123",
        claimCredential: "co_agent_mockcredential",
        tenantId: "ten_test123",
        status: "CLAIMED",
        nextAction: "REGISTER_GATEWAY"
      };

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockClaim
      } as any);

      const client = new OnboardingClient("http://localhost:3000");
      const res = await client.claimCredential("co_inv_testtoken", "jr_test123");

      expect(res.agentId).toBe("ag_testagent123");
      expect(res.claimCredential).toBe("co_agent_mockcredential");

      fetchSpy.mockRestore();
    });

    it("enforces credential secrecy and does not expose tokens in error strings", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

      const client = new OnboardingClient("http://localhost:3000");
      try {
        await client.getManifest("co_inv_super_secret_token_12345");
        expect.unreachable("Should have failed");
      } catch (err: any) {
        expect(err.message).not.toContain("co_inv_super_secret_token_12345");
      }

      fetchSpy.mockRestore();
    });
  });

  describe("GatewayClient", () => {
    it("requires a runtime credential for runtime connection if not already stored", async () => {
      const client = new GatewayClient({ wsUrl: "ws://localhost:3000/v1/gateway/ws" });
      await expect(client.connectWithRuntime()).rejects.toThrow("No runtime credential available");
    });
  });
});
