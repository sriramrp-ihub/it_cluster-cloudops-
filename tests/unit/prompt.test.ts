import { describe, it, expect } from "vitest";
import { generateOnboardingPrompt } from "@cloudops/onboarding";

describe("generateOnboardingPrompt", () => {
  const baseOptions = {
    inviteToken: "co_inv_test_token_1234567890abcdef1234567890abcdef1234567890",
    tenantId: "ten_test_tenant",
    expiresAt: new Date(Date.now() + 86400 * 1000),
    apiBaseUrl: "http://localhost:3000",
    wsBaseUrl: "ws://localhost:3000",
    agentName: "hermes-ops-worker-01",
    agentType: "hermes" as const,
    instructions: "Operate AWS ECS and CloudWatch infrastructure."
  };

  it("generates a complete, self-contained onboarding prompt for Hermes agent", () => {
    const prompt = generateOnboardingPrompt(baseOptions);

    // Identity and parameters
    expect(prompt).toContain("CLOUDOPS AGENT ONBOARDING INSTRUCTIONS");
    expect(prompt).toContain("hermes-ops-worker-01");
    expect(prompt).toContain("hermes");
    expect(prompt).toContain("ten_test_tenant");
    expect(prompt).toContain("co_inv_test_token_1234567890abcdef1234567890abcdef1234567890");
    expect(prompt).toContain("Single-Use Only");

    // Endpoints
    expect(prompt).toContain("GET http://localhost:3000/v1/onboarding/co_inv_test_token_");
    expect(prompt).toContain("POST http://localhost:3000/v1/onboarding/co_inv_test_token_");
    expect(prompt).toContain("POST http://localhost:3000/v1/onboarding/claim");
    expect(prompt).toContain("ws://localhost:3000/v1/gateway/ws");

    // 5-step lifecycle instructions
    expect(prompt).toContain("Step 1: Discover Onboarding Manifest");
    expect(prompt).toContain("Step 2: Submit Declarative Join Request");
    expect(prompt).toContain("Step 3: Await Human Operator Approval");
    expect(prompt).toContain("Step 4: Claim One-Time Bootstrap Credential");
    expect(prompt).toContain("Step 5: Connect to CloudOps");

    // Operator instructions
    expect(prompt).toContain("Operate AWS ECS and CloudWatch infrastructure.");

    // Security boundaries
    expect(prompt).toContain("Declared Capabilities ≠ Authorized Privileges");
    expect(prompt).toContain("Do NOT attempt to access cloud infrastructure directly or bypass CloudOps");
    expect(prompt).toContain("Never expose invitation tokens, claim credentials, or runtime secrets");
  });

  it("adapts framework guidance for OpenClaw and Custom runtimes", () => {
    const openclawPrompt = generateOnboardingPrompt({
      ...baseOptions,
      agentName: "openclaw-worker-01",
      agentType: "openclaw"
    });
    expect(openclawPrompt).toContain("OpenClaw Operational Daemon");
    expect(openclawPrompt).toContain("openclaw-worker-01");

    const customPrompt = generateOnboardingPrompt({
      ...baseOptions,
      agentName: "custom-agent-01",
      agentType: "custom"
    });
    expect(customPrompt).toContain("Custom ACP Agent");
    expect(customPrompt).toContain("custom-agent-01");
  });

  it("handles empty/undefined instructions cleanly", () => {
    const prompt = generateOnboardingPrompt({
      ...baseOptions,
      instructions: undefined
    });
    expect(prompt).not.toContain("### Operator Assignment & Operational Scope");
    expect(prompt).toContain("CLOUDOPS AGENT ONBOARDING INSTRUCTIONS");
  });

  it("does NOT expose internal database credentials, hashes, or cloud secrets", () => {
    const prompt = generateOnboardingPrompt(baseOptions);

    expect(prompt).not.toMatch(/postgres:\/\//i);
    expect(prompt).not.toMatch(/AKIA[0-9A-Z]{16}/); // AWS Access Key pattern
    expect(prompt).not.toMatch(/password/i);
    expect(prompt).not.toContain("token_hash");
    expect(prompt).not.toContain("DefenseClaw");
    expect(prompt).not.toContain("agent_credentials");
    expect(prompt).not.toContain("agent_sessions");
  });
});
