import { describe, it, expect, beforeEach } from "vitest";
import { AwsSessionManager } from "@cloudops/adapters";

describe("AwsSessionManager Unit Tests", () => {
  let sessionManager: AwsSessionManager;

  beforeEach(() => {
    sessionManager = new AwsSessionManager();
  });

  it("stores and retrieves active session within tenant boundary", () => {
    sessionManager.createSession("ten_tenant_1", "cld_123", {
      provider: "aws",
      accountId: "123456789012",
      region: "us-east-1",
      roleArn: "arn:aws:iam::123456789012:role/CloudOpsRole",
      credentials: {
        accessKeyId: "ASIAEXAMPLEKEY1",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1",
        sessionToken: "session-token-1"
      }
    });

    const session = sessionManager.getSession("ten_tenant_1", "cld_123");
    expect(session).toBeDefined();
    expect(session?.accountId).toBe("123456789012");
    expect(session?.credentials.accessKeyId).toBe("ASIAEXAMPLEKEY1");
    expect(sessionManager.hasValidSession("ten_tenant_1", "cld_123")).toBe(true);

    // Ensure tenant 2 cannot access tenant 1's session
    expect(sessionManager.getSession("ten_tenant_2", "cld_123")).toBeUndefined();
    expect(sessionManager.hasValidSession("ten_tenant_2", "cld_123")).toBe(false);
  });

  it("provides credentials exclusively for internal Tool Gateway calls", () => {
    sessionManager.createSession("ten_tenant_1", "cld_456", {
      provider: "aws",
      accountId: "999888777666",
      region: "eu-west-1",
      credentials: {
        accessKeyId: "ASIAEXAMPLEKEY2",
        secretAccessKey: "secretKey2",
        sessionToken: "token2"
      }
    });

    const creds = sessionManager.getCredentials("ten_tenant_1", "cld_456");
    expect(creds?.accessKeyId).toBe("ASIAEXAMPLEKEY2");
    expect(creds?.secretAccessKey).toBe("secretKey2");
    expect(creds?.sessionToken).toBe("token2");

    // Cross-tenant returns undefined
    expect(sessionManager.getCredentials("ten_tenant_other", "cld_456")).toBeUndefined();
  });

  it("automatically invalidates and evicts expired credentials", () => {
    const expiredDate = new Date(Date.now() - 10000); // 10 seconds ago
    sessionManager.createSession("ten_tenant_1", "cld_expired", {
      provider: "aws",
      accountId: "111222333444",
      region: "us-west-2",
      credentials: {
        accessKeyId: "ASIAEXPIRED",
        secretAccessKey: "secretExpired",
        expiration: expiredDate
      }
    });

    expect(sessionManager.getSession("ten_tenant_1", "cld_expired")).toBeUndefined();
    expect(sessionManager.hasValidSession("ten_tenant_1", "cld_expired")).toBe(false);
    expect(sessionManager.activeSessionCount).toBe(0);
  });

  it("deletes session and prevents subsequent access on disconnect", () => {
    sessionManager.createSession("ten_tenant_1", "cld_789", {
      provider: "aws",
      accountId: "555666777888",
      region: "us-east-1",
      credentials: {
        accessKeyId: "ASIAKEY789",
        secretAccessKey: "secret789"
      }
    });

    expect(sessionManager.hasValidSession("ten_tenant_1", "cld_789")).toBe(true);

    const deleted = sessionManager.deleteSession("ten_tenant_1", "cld_789");
    expect(deleted).toBe(true);
    expect(sessionManager.hasValidSession("ten_tenant_1", "cld_789")).toBe(false);
    expect(sessionManager.getSession("ten_tenant_1", "cld_789")).toBeUndefined();
  });

  it("clears only tenant-specific sessions on clearTenantSessions", () => {
    sessionManager.createSession("ten_alpha", "cld_a1", {
      provider: "aws",
      accountId: "111",
      region: "us-east-1",
      credentials: { accessKeyId: "KEY_A1", secretAccessKey: "SEC_A1" }
    });
    sessionManager.createSession("ten_alpha", "cld_a2", {
      provider: "aws",
      accountId: "222",
      region: "us-east-1",
      credentials: { accessKeyId: "KEY_A2", secretAccessKey: "SEC_A2" }
    });
    sessionManager.createSession("ten_beta", "cld_b1", {
      provider: "aws",
      accountId: "333",
      region: "us-east-1",
      credentials: { accessKeyId: "KEY_B1", secretAccessKey: "SEC_B1" }
    });

    expect(sessionManager.activeSessionCount).toBe(3);

    sessionManager.clearTenantSessions("ten_alpha");

    expect(sessionManager.activeSessionCount).toBe(1);
    expect(sessionManager.hasValidSession("ten_alpha", "cld_a1")).toBe(false);
    expect(sessionManager.hasValidSession("ten_alpha", "cld_a2")).toBe(false);
    expect(sessionManager.hasValidSession("ten_beta", "cld_b1")).toBe(true);
  });
});
