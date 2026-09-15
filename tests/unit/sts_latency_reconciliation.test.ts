import { describe, it, expect, beforeEach } from "vitest";
import { AwsSessionManager } from "@cloudops/adapters";

describe("Phase 1.10 — STS Latency vs 250ms Target Reconciliation", () => {
  let sessionManager: AwsSessionManager;

  beforeEach(() => {
    sessionManager = new AwsSessionManager();
  });

  it("delivers sub-millisecond credential retrieval on warm in-memory session cache", () => {
    const tenantId = "ten_perf_test";
    const cloudAccountId = "cld_perf_123";

    // Warm up the session cache with brokered STS credentials valid for 15 minutes
    const expiration = new Date(Date.now() + 15 * 60 * 1000);
    sessionManager.createSession(tenantId, cloudAccountId, {
      provider: "aws",
      accountId: "123456789012",
      region: "us-east-1",
      credentials: {
        accessKeyId: "ASIAEXAMPLEWARMKEY",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        sessionToken: "warm-session-token",
        expiration
      }
    });

    // Benchmark warm retrieval latency
    const start = performance.now();
    const creds = sessionManager.getCredentials(tenantId, cloudAccountId);
    const durationMs = performance.now() - start;

    expect(creds).toBeDefined();
    expect(creds?.accessKeyId).toBe("ASIAEXAMPLEWARMKEY");
    // Warm retrieval must be well under 250ms (typically < 1ms)
    expect(durationMs).toBeLessThan(10);
  });

  it("evicts credentials when the bounded validity window expires", () => {
    const tenantId = "ten_perf_test";
    const cloudAccountId = "cld_perf_expired";

    // Expired 5 seconds ago
    const expiration = new Date(Date.now() - 5000);
    sessionManager.createSession(tenantId, cloudAccountId, {
      provider: "aws",
      accountId: "123456789012",
      region: "us-east-1",
      credentials: {
        accessKeyId: "ASIAEXPIREDKEY",
        secretAccessKey: "expiredSecret",
        sessionToken: "expiredToken",
        expiration
      }
    });

    const creds = sessionManager.getCredentials(tenantId, cloudAccountId);
    expect(creds).toBeUndefined();
    expect(sessionManager.hasValidSession(tenantId, cloudAccountId)).toBe(false);
  });
});
