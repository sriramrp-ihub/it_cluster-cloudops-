import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import {
  generateTenantId,
  AuthenticationError,
  CloudAdapterError,
  REDACTED_PATHS
} from "@cloudops/shared";
import {
  CloudAccountService,
  AwsSessionManager,
  CloudAccountRepository,
  IAwsStsService,
  AwsCredentials,
  CallerIdentityResult,
  AssumeRoleParams,
  AssumedSessionResult
} from "@cloudops/adapters";

/**
 * Mock STS service for fast, deterministic unit/integration security tests
 */
class MockStsService implements IAwsStsService {
  public shouldFailAuth = false;
  public shouldFailAssumeRole = false;
  public mockAccountId = "123456789012";

  async getCallerIdentity(credentials: AwsCredentials, _region: string): Promise<CallerIdentityResult> {
    if (this.shouldFailAuth || credentials.accessKeyId.includes("INVALID")) {
      throw new AuthenticationError("Invalid AWS credentials: authentication failed with AWS STS", {
        awsErrorCode: "InvalidClientTokenId"
      });
    }

    return {
      accountId: this.mockAccountId,
      arn: `arn:aws:iam::${this.mockAccountId}:user/cloudops-operator`,
      userId: "AIDAEXAMPLEUSER"
    };
  }

  async assumeRole(_credentials: AwsCredentials, _region: string, params: AssumeRoleParams): Promise<AssumedSessionResult> {
    if (this.shouldFailAssumeRole || params.roleArn.includes("FailRole")) {
      throw new CloudAdapterError("Unable to assume IAM role: AccessDenied", {
        roleArn: params.roleArn,
        awsErrorCode: "AccessDenied"
      });
    }

    return {
      credentials: {
        accessKeyId: "ASIATEMPACCESSKEY123",
        secretAccessKey: "secretAccessKeyFromSTSAssumeRole",
        sessionToken: "sessionTokenFromSTSAssumeRole",
        expiration: new Date(Date.now() + 3600000)
      },
      assumedRoleUser: {
        arn: `arn:aws:sts::${this.mockAccountId}:assumed-role/CloudOpsRole/cloudops-session`,
        assumedRoleId: "AROAEXAMPLE:cloudops-session"
      }
    };
  }
}

describe("AWS Cloud Accounts Security & Integration Tests", () => {
  let app: ReturnType<typeof buildApp>;
  let mockSts: MockStsService;
  let sessionManager: AwsSessionManager;
  let cloudAccountService: CloudAccountService;

  const tenantAId = generateTenantId();
  const tenantBId = generateTenantId();
  const operatorAId = "op_admin_tenant_a";
  const operatorBId = "op_admin_tenant_b";

  beforeAll(async () => {
    await runMigrations();

    const db = getDatabase();
    await db.insertInto("tenants").values([
      { id: tenantAId, name: "Tenant Alpha AWS" },
      { id: tenantBId, name: "Tenant Beta AWS" }
    ]).execute();
  });

  beforeEach(async () => {
    mockSts = new MockStsService();
    sessionManager = new AwsSessionManager();
    const repo = new CloudAccountRepository();
    cloudAccountService = new CloudAccountService(mockSts, sessionManager, repo);

    app = buildApp({
      cloudAccountService
    });
    await app.ready();
  });

  afterAll(async () => {
    const db = getDatabase();
    for (const tid of [tenantAId, tenantBId]) {
      await db.deleteFrom("cloud_accounts").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("tenants").where("id", "=", tid).execute();
    }
    await app.close();
    await closeDatabase();
  });

  // Security Test 1: Valid AWS credentials can authenticate
  it("1. Valid AWS credentials can authenticate, create CONNECTED account, and return safe metadata", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.id.startsWith("cld_")).toBe(true);
    expect(body.provider).toBe("aws");
    expect(body.accountId).toBe("123456789012");
    expect(body.region).toBe("us-east-1");
    expect(body.status).toBe("CONNECTED");
    expect(body.createdAt).toBeDefined();
  });

  // Security Test 2: Invalid credentials fail
  it("2. Invalid AWS credentials fail with HTTP 401 AUTHENTICATION_ERROR", async () => {
    mockSts.shouldFailAuth = true;

    const res = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "us-east-1",
        accessKeyId: "AKIAINVALIDKEYID999",
        secretAccessKey: "invalidSecretKeyHere123"
      }
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
    expect(body.error.message).toContain("Invalid AWS credentials");
  });

  // Security Test 3: Invalid Role ARN fails
  it("3. Malformed or invalid Role ARN fails with HTTP 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        assumeRoleArn: "https://ssrf-exploit.internal/metadata"
      }
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Invalid Assume Role ARN");
  });

  // Security Test 4: AssumeRole failure does not create CONNECTED account
  it("4. AssumeRole failure rejects connection and does not create a CONNECTED account in DB", async () => {
    mockSts.shouldFailAssumeRole = true;

    const res = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "us-west-2",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        assumeRoleArn: "arn:aws:iam::123456789012:role/FailRole"
      }
    });

    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("CLOUD_ADAPTER_ERROR");

    // Verify database does not contain a record for this region
    const db = getDatabase();
    const row = await db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("tenant_id", "=", tenantAId)
      .where("region", "=", "us-west-2")
      .executeTakeFirst();

    expect(row).toBeUndefined();
    expect(sessionManager.activeSessionCount).toBe(0);
  });

  // Security Test 5: Access keys are not persisted in PostgreSQL
  it("5. Verifies secret access keys and tokens are NEVER stored in PostgreSQL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "SUPER_SECRET_KEY_NOT_IN_DB",
        sessionToken: "SUPER_SECRET_SESSION_TOKEN"
      }
    });

    expect(res.statusCode).toBe(201);
    const accountId = JSON.parse(res.body).id;

    // Direct raw SQL query on database to inspect all columns
    const db = getDatabase();
    const rawRow = await db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("id", "=", accountId)
      .executeTakeFirst();

    expect(rawRow).toBeDefined();
    const rowKeys = Object.keys(rawRow || {});

    // Strictly guarantee no secret column names exist
    expect(rowKeys).not.toContain("access_key_id");
    expect(rowKeys).not.toContain("secret_access_key");
    expect(rowKeys).not.toContain("session_token");
    expect(rowKeys).not.toContain("credentials");

    const rowString = JSON.stringify(rawRow);
    expect(rowString).not.toContain("SUPER_SECRET_KEY_NOT_IN_DB");
    expect(rowString).not.toContain("SUPER_SECRET_SESSION_TOKEN");
  });

  // Security Test 6 & 7: Secret keys and session tokens never returned in API responses
  it("6 & 7. Secret access keys and session tokens are never returned in API responses", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "ap-southeast-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        sessionToken: "session-token-secret-value"
      }
    });

    expect(res.statusCode).toBe(201);
    const responseBody = res.body;

    expect(responseBody).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(responseBody).not.toContain("session-token-secret-value");

    const parsed = JSON.parse(responseBody);
    expect(parsed.secretAccessKey).toBeUndefined();
    expect(parsed.sessionToken).toBeUndefined();
    expect(parsed.credentials).toBeUndefined();
  });

  // Security Test 8: Credentials are not logged (verifies redaction config)
  it("8. Logging configuration includes comprehensive credential redaction paths", () => {
    expect(REDACTED_PATHS).toContain("accessKeyId");
    expect(REDACTED_PATHS).toContain("secretAccessKey");
    expect(REDACTED_PATHS).toContain("sessionToken");
    expect(REDACTED_PATHS).toContain("credential");
    expect(REDACTED_PATHS).toContain("credentials");
  });

  // Security Test 9: Tenant isolation works
  it("9. Tenant isolation ensures Tenant B cannot list or delete Tenant A cloud accounts", async () => {
    // 1. Tenant A connects an account
    const connectRes = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "us-east-2",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      }
    });
    expect(connectRes.statusCode).toBe(201);
    const tenantAAccountId = JSON.parse(connectRes.body).id;

    // 2. Tenant B lists accounts -> must NOT see Tenant A's account
    const listBRes = await app.inject({
      method: "GET",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantBId,
        "x-operator-id": operatorBId
      }
    });
    expect(listBRes.statusCode).toBe(200);
    const listB = JSON.parse(listBRes.body);
    const foundCrossTenant = listB.find((acc: any) => acc.id === tenantAAccountId);
    expect(foundCrossTenant).toBeUndefined();

    // 3. Tenant B attempts to delete Tenant A's account -> 404 NOT_FOUND
    const deleteCrossRes = await app.inject({
      method: "DELETE",
      url: `/v1/cloud-accounts/${tenantAAccountId}`,
      headers: {
        "x-tenant-id": tenantBId,
        "x-operator-id": operatorBId
      }
    });
    expect(deleteCrossRes.statusCode).toBe(404);

    // 4. In-memory session for Tenant A must still be valid
    expect(sessionManager.hasValidSession(tenantAId, tenantAAccountId)).toBe(true);
  });

  // Security Test 10: Duplicate submission is handled cleanly
  it("10. Duplicate connection for same (tenant, provider, accountId, region) updates existing record without creating duplicates", async () => {
    // First connection
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "ca-central-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      }
    });
    expect(res1.statusCode).toBe(201);
    const id1 = JSON.parse(res1.body).id;

    // Second connection for same region and account
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "ca-central-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        assumeRoleArn: "arn:aws:iam::123456789012:role/NewRole"
      }
    });
    expect(res2.statusCode).toBe(201);
    const id2 = JSON.parse(res2.body).id;

    // Reuses the existing account ID and updates metadata
    expect(id2).toBe(id1);
    expect(JSON.parse(res2.body).roleArn).toBe("arn:aws:iam::123456789012:role/NewRole");

    // Check DB has exactly 1 row for ca-central-1
    const db = getDatabase();
    const rows = await db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("tenant_id", "=", tenantAId)
      .where("region", "=", "ca-central-1")
      .execute();

    expect(rows.length).toBe(1);
  });

  // Security Test 11: Disconnect invalidates the session
  it("11. Disconnect removes database record and invalidates in-memory session", async () => {
    const connectRes = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "sa-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      }
    });
    const accountId = JSON.parse(connectRes.body).id;

    // Session is active
    expect(sessionManager.hasValidSession(tenantAId, accountId)).toBe(true);

    // Disconnect
    const disconnectRes = await app.inject({
      method: "DELETE",
      url: `/v1/cloud-accounts/${accountId}`,
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      }
    });
    expect(disconnectRes.statusCode).toBe(200);

    // In-memory session is invalidated
    expect(sessionManager.hasValidSession(tenantAId, accountId)).toBe(false);
    expect(sessionManager.getSession(tenantAId, accountId)).toBeUndefined();

    // Database record is removed
    const db = getDatabase();
    const row = await db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("id", "=", accountId)
      .executeTakeFirst();

    expect(row).toBeUndefined();
  });

  // Security Test 12: Temporary credentials are not exposed to agents
  it("12. Temporary credentials are kept isolated in AwsSessionManager and never returned in GET or lists", async () => {
    const connectRes = await app.inject({
      method: "POST",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        provider: "aws",
        region: "ap-northeast-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        assumeRoleArn: "arn:aws:iam::123456789012:role/CloudOpsRole"
      }
    });
    const accountId = JSON.parse(connectRes.body).id;

    // Verify session manager holds credentials for Tool Gateway
    const internalCreds = sessionManager.getCredentials(tenantAId, accountId);
    expect(internalCreds?.accessKeyId).toBe("ASIATEMPACCESSKEY123");
    expect(internalCreds?.secretAccessKey).toBe("secretAccessKeyFromSTSAssumeRole");

    // Verify GET list API returns only safe metadata and zero credentials
    const getRes = await app.inject({
      method: "GET",
      url: "/v1/cloud-accounts",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      }
    });
    const listBody = getRes.body;
    expect(listBody).not.toContain("ASIATEMPACCESSKEY123");
    expect(listBody).not.toContain("secretAccessKeyFromSTSAssumeRole");
    expect(listBody).not.toContain("sessionTokenFromSTSAssumeRole");
  });
});
