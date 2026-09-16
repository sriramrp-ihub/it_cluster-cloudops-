import { describe, it, expect } from "vitest";
import { AwsStsService, CloudAccountService, AwsIncidentEnvironment } from "@cloudops/adapters";
import { getDatabase } from "@cloudops/database";
import * as dotenv from "dotenv";

dotenv.config();

describe("Real AWS Live Account Connection & Guardrail Verification (Step 2.4)", () => {
  const realSts = new AwsStsService();
  const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
  };
  const region = process.env.AWS_REGION || "us-east-1";
  const expectedAccountId = process.env.AWS_ACCOUNT_ID || "265766933076";
  const readOnlyRoleArn = process.env.AWS_READONLY_ROLE_ARN || `arn:aws:iam::${expectedAccountId}:role/CloudOpsReadOnlyRole`;
  const remediationRoleArn = process.env.AWS_REMEDIATION_ROLE_ARN || `arn:aws:iam::${expectedAccountId}:role/CloudOpsRemediationRole`;

  it("1. Confirms credentials exist and are non-empty", () => {
    expect(credentials.accessKeyId).toBeDefined();
    expect(credentials.accessKeyId).toMatch(/^AKIA/);
    expect(credentials.secretAccessKey).toBeDefined();
    expect(credentials.secretAccessKey.length).toBeGreaterThan(20);
  });

  it("2. Validates STS GetCallerIdentity against live AWS (CO-004) and asserts scoped IAM user (NOT ROOT)", async () => {
    const callerId = await realSts.getCallerIdentity(credentials, region);

    expect(callerId.accountId).toBe(expectedAccountId);
    expect(callerId.arn).toContain(":user/cloudops-operator");
    // Explicit assertion: Must NOT be root account!
    expect(callerId.arn).not.toContain(":root");
  });

  it("3. Validates live STS AssumeRole into CloudOpsReadOnlyRole (CO-006 & ADR-0003)", async () => {
    const assumed = await realSts.assumeRole(credentials, region, {
      roleArn: readOnlyRoleArn
    });

    expect(assumed.credentials.accessKeyId).toMatch(/^ASIA/);
    expect(assumed.credentials.sessionToken).toBeDefined();
    expect(assumed.assumedRoleUser.arn).toContain("assumed-role/CloudOpsReadOnlyRole");
  });

  it("4. Validates live STS AssumeRole into CloudOpsRemediationRole (CO-006 & ADR-0003)", async () => {
    const assumed = await realSts.assumeRole(credentials, region, {
      roleArn: remediationRoleArn
    });

    expect(assumed.credentials.accessKeyId).toMatch(/^ASIA/);
    expect(assumed.credentials.sessionToken).toBeDefined();
    expect(assumed.assumedRoleUser.arn).toContain("assumed-role/CloudOpsRemediationRole");
  });

  it("5. Connects account through CloudAccountService and stores safe record in DB", async () => {
    const service = new CloudAccountService();
    const db = getDatabase();
    const tenantId = `ten_live_${Date.now()}`;
    await db.insertInto("tenants").values({ id: tenantId, name: "Live AWS Tenant" }).execute();

    const account = await service.connectAws({
      tenantId,
      region,
      name: "AWS Production Primary",
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      assumeRoleArn: readOnlyRoleArn
    });

    expect(account.id).toBeDefined();
    expect(account.accountId).toBe(expectedAccountId);
    expect(account.status).toBe("CONNECTED");
    expect(account.roleArn).toBe(readOnlyRoleArn);

    // Verify zero credentials in database
    const row = await db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("id", "=", account.id)
      .executeTakeFirstOrThrow();

    expect((row as any).credentials).toBeUndefined();
    expect((row as any).secretAccessKey).toBeUndefined();
  });
});
