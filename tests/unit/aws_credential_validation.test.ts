import { describe, it, expect, beforeEach } from "vitest";
import {
  CloudAccountService,
  AwsSessionManager,
  ICloudAccountRepository,
  IAwsStsService,
  CloudAccountRecord
} from "@cloudops/adapters";
import { AuthenticationError, ValidationError } from "@cloudops/shared";

describe("AWS Pre-Investigation Credential Validation (CO-004)", () => {
  const tenantId = "ten_validation_test";
  const expectedAccountId = "123456789012";
  const expectedRegion = "us-east-1";

  let mockSts: IAwsStsService;
  let mockRepo: ICloudAccountRepository;
  let sessionManager: AwsSessionManager;
  let service: CloudAccountService;

  beforeEach(() => {
    sessionManager = new AwsSessionManager();

    mockSts = {
      getCallerIdentity: async () => ({
        accountId: expectedAccountId,
        arn: `arn:aws:iam::${expectedAccountId}:user/operator`,
        userId: "AIDAEXAMPLE"
      }),
      assumeRole: async () => {
        throw new Error("Not implemented in test");
      }
    };

    const records: CloudAccountRecord[] = [
      {
        id: "cld_account_01",
        tenantId,
        provider: "aws",
        accountId: expectedAccountId,
        roleArn: null,
        region: expectedRegion,
        status: "CONNECTED",
        lastValidatedAt: new Date(),
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    mockRepo = {
      create: async () => records[0],
      getById: async () => records[0],
      findExisting: async () => records[0],
      listByTenant: async () => records,
      updateStatus: async () => records[0],
      delete: async () => true
    };

    service = new CloudAccountService(mockSts, sessionManager, mockRepo);

    // Populate active in-memory session
    sessionManager.createSession(tenantId, "cld_account_01", {
      provider: "aws",
      accountId: expectedAccountId,
      region: expectedRegion,
      roleArn: null,
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "secretKey",
        sessionToken: undefined
      }
    });
  });

  it("1. Passes validation when account ID and region match connected active credentials", async () => {
    const result = await service.validateInvestigationEnvironment(tenantId, expectedAccountId, expectedRegion);
    expect(result.valid).toBe(true);
    expect(result.accountId).toBe(expectedAccountId);
    expect(result.region).toBe(expectedRegion);
  });

  it("2. Fails closed when expected account ID does not match connected account", async () => {
    await expect(
      service.validateInvestigationEnvironment(tenantId, "999999999999", expectedRegion)
    ).rejects.toThrow(AuthenticationError);
  });

  it("3. Fails closed when expected region does not match connected account", async () => {
    await expect(
      service.validateInvestigationEnvironment(tenantId, expectedAccountId, "eu-central-1")
    ).rejects.toThrow(AuthenticationError);
  });

  it("4. Fails closed when active in-memory STS session is absent or expired", async () => {
    sessionManager.deleteSession(tenantId, "cld_account_01");
    await expect(
      service.validateInvestigationEnvironment(tenantId, expectedAccountId, expectedRegion)
    ).rejects.toThrow(AuthenticationError);
  });

  it("5. Fails closed when STS GetCallerIdentity returns a different account ID", async () => {
    mockSts.getCallerIdentity = async () => ({
      accountId: "888888888888",
      arn: "arn:aws:iam::888888888888:user/spoofed",
      userId: "AIDASPOOFED"
    });

    await expect(
      service.validateInvestigationEnvironment(tenantId, expectedAccountId, expectedRegion)
    ).rejects.toThrow(ValidationError);
  });
});
