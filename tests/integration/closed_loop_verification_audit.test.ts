import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  AwsIncidentEnvironmentManager,
  RemediationVerificationService,
  ECS_INCIDENT_GROUND_TRUTH,
  IncidentService
} from "@cloudops/adapters";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { AuditService } from "@cloudops/audit";
import { MockAgentAdapter } from "@cloudops/runtime";
import {
  BenchmarkTimingTracker,
  type TenantId,
  type AgentId
} from "@cloudops/shared";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("V4: Closed-Loop Execution, Verification, Audit & Benchmark (CO-022 -> CO-028)", () => {
  let envManager: AwsIncidentEnvironmentManager;
  let verificationService: RemediationVerificationService;
  let approvalService: ApprovalService;
  let auditService: AuditService;
  let mockAdapter: MockAgentAdapter;
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  const tenantId = "ten_default_tenant" as TenantId;
  const agentId = "ag_default_sre" as AgentId;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();

    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "V4 Verification Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "V4 Remediation SRE Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "acp",
        status: "CONNECTED"
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    envManager = new AwsIncidentEnvironmentManager();
    verificationService = new RemediationVerificationService(envManager);
    approvalService = new ApprovalService();
    auditService = new AuditService();
    operatorKeyPair = OperatorSignatureService.generateKeyPair();
    mockAdapter = new MockAgentAdapter({
      fixturesDir: path.resolve(__dirname, "../../packages/runtime/fixtures")
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe("CO-022: Controlled Remediation Execution Across All Terminal Outcomes", () => {
    it("terminal state 1: EXECUTED - successfully executes approved mutation", async () => {
      const approval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_update_service",
        rawPayload: { cluster: "cloudops-demo-cluster", service: "checkout-service", imageTag: "v2.4.0-stable" }
      });

      const signedAt = new Date();
      const sig = OperatorSignatureService.signApproval(
        approval.id,
        approval.operationPayloadHash,
        signedAt.getTime(),
        operatorKeyPair.privateKeyPem
      );

      await approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_sre",
        signature: sig,
        publicKeyPem: operatorKeyPair.publicKeyPem,
        signedAt
      });

      const result = await approvalService.executeApproval(tenantId, approval.id, async (payload) => {
        return { updated: true, service: payload.service };
      });

      expect(result).toEqual({ updated: true, service: "checkout-service" });

      const finalRecord = await approvalService.getApproval(tenantId, approval.id);
      expect(finalRecord?.status).toBe("EXECUTED");
    });

    it("terminal state 2: EXECUTION_FAILED - captures cloud failure and records error", async () => {
      const approval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_update_service",
        rawPayload: { cluster: "cloudops-demo-cluster", service: "checkout-service" }
      });

      const signedAt = new Date();
      const sig = OperatorSignatureService.signApproval(
        approval.id,
        approval.operationPayloadHash,
        signedAt.getTime(),
        operatorKeyPair.privateKeyPem
      );

      await approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_sre",
        signature: sig,
        publicKeyPem: operatorKeyPair.publicKeyPem,
        signedAt
      });

      await expect(
        approvalService.executeApproval(tenantId, approval.id, async () => {
          throw new Error("AWS ECS ServiceUnavailableException: Cluster undergoing maintenance");
        })
      ).rejects.toThrow("AWS ECS ServiceUnavailableException");

      const finalRecord = await approvalService.getApproval(tenantId, approval.id);
      expect(finalRecord?.status).toBe("EXECUTION_FAILED");
      expect(finalRecord?.errorMessage).toContain("ServiceUnavailableException");
    });

    it("terminal state 3: EXPIRED - auto-expires stale approvals past TTL", async () => {
      const expiredApproval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_update_service",
        rawPayload: { service: "checkout-service" },
        expiresInSeconds: -5
      });

      const record = await approvalService.getApproval(tenantId, expiredApproval.id);
      expect(record?.status).toBe("EXPIRED");
    });

    it("terminal state 4: REJECTED - operator rejects high-risk action", async () => {
      const approval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_update_service",
        rawPayload: { service: "checkout-service", desiredCount: 100 }
      });

      const rejected = await approvalService.reject(
        tenantId,
        approval.id,
        "op_sre",
        "Scale count of 100 exceeds safety limits"
      );

      expect(rejected.status).toBe("REJECTED");
      expect(rejected.errorMessage).toContain("Scale count of 100 exceeds safety limits");
    });
  });

  describe("CO-023: Post-Remediation Verification & Rollback Protection", () => {
    it("fails verification when environment is degraded and succeeds when healthy", async () => {
      // Degraded state (broken image injected)
      envManager.injectFailure();
      const failCheck = await verificationService.verifyRecovery();
      expect(failCheck.recovered).toBe(false);
      expect(failCheck.checks.albHealthy).toBe(false);

      // Restored state (healthy baseline restored)
      envManager.resetScenario();
      const passCheck = await verificationService.verifyRecovery();
      expect(passCheck.recovered).toBe(true);
      expect(passCheck.checks.taskCountsMatch).toBe(true);
      expect(passCheck.checks.albHealthy).toBe(true);
      expect(passCheck.checks.imageMatchesTarget).toBe(true);
    });

    it("executes pre-execution state snapshot rollback when remediation fails verification", async () => {
      // 1. Capture snapshot before mutation
      const preSnapshot = {
        taskDefinition: "arn:aws:ecs:us-east-1:265766933076:task-definition/checkout-service:1",
        imageTag: ECS_INCIDENT_GROUND_TRUTH.healthyImageTag,
        desiredCount: 1
      };

      // 2. Failure occurs during deployment
      envManager.injectFailure();
      expect(envManager.getHealthStatus().status).toBe("CRITICAL");

      // 3. Rollback using pre-execution snapshot
      const rollbackResult = await verificationService.executeRollback(preSnapshot);
      expect(rollbackResult.rolledBack).toBe(true);
      expect(rollbackResult.restoredImage).toBe(preSnapshot.imageTag);

      // 4. Verify post-rollback health
      const verify = await verificationService.verifyRecovery();
      expect(verify.recovered).toBe(true);
    });
  });

  describe("CO-024: Tamper-Evident Incident Audit Trail", () => {
    it("verifies intact SHA-256 hash-chain and detects intentional database tampering", async () => {
      const db = getDatabase();
      const auditTestTenantId = `ten_audit_${Date.now()}`;

      await db
        .insertInto("tenants")
        .values({ id: auditTestTenantId, name: "Audit Tamper Test Tenant" })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();

      // 1. Record several valid audit events
      await auditService.recordEvent({
        tenantId: auditTestTenantId,
        eventType: "INCIDENT_TRIGGERED",
        actorType: "SYSTEM",
        actorId: "sys_monitor",
        payload: { incidentId: "inc_001", alert: "Target5xxHigh" }
      });

      const event2 = await auditService.recordEvent({
        tenantId: auditTestTenantId,
        eventType: "REMEDIATION_APPROVED",
        actorType: "OPERATOR",
        actorId: "op_sre",
        payload: { approvalId: "appr_001", action: "aws_ecs_rollback" }
      });

      // 2. Verify initial chain is 100% intact
      const intactCheck = await auditService.verifyChain(auditTestTenantId);
      expect(intactCheck.valid).toBe(true);
      expect(intactCheck.totalChecked).toBe(2);

      // 3. Deliberately tamper with event2's payload in the database
      await db
        .updateTable("audit_events")
        .set({
          payload: JSON.stringify({ approvalId: "appr_001", action: "TAMPERED_ACTION_FORGED" }) as any
        })
        .where("id", "=", event2.id)
        .execute();

      // 4. Run cryptographic chain verifier and assert it detects the tampering
      const tamperedCheck = await auditService.verifyChain(auditTestTenantId);
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.brokenRowId).toBe(event2.id);
      expect(tamperedCheck.error).toContain("Tampered row detected");
    });

  });

  describe("CO-026: Benchmark Timing Instrumentation (Formal Deferral)", () => {
    it("records phase timings without synthesizing or fabricating fake time-saved metrics", async () => {
      const tracker = new BenchmarkTimingTracker("inc_demo_001", "ecs-image-pull-failure", true);

      // Phase 1: Investigation
      tracker.startPhase("investigation");
      await new Promise((r) => setTimeout(r, 10));
      tracker.endPhase("investigation");

      // Phase 2: Approval
      tracker.startPhase("approval");
      await new Promise((r) => setTimeout(r, 10));
      tracker.endPhase("approval");

      // Phase 3: Remediation
      tracker.startPhase("remediation");
      await new Promise((r) => setTimeout(r, 10));
      tracker.endPhase("remediation");

      // Phase 4: Verification
      tracker.startPhase("verification");
      await new Promise((r) => setTimeout(r, 10));
      tracker.endPhase("verification");

      const metrics = tracker.getMetrics();
      expect(metrics.incidentId).toBe("inc_demo_001");
      expect(metrics.phases.investigation.durationMs).toBeGreaterThan(0);
      expect(metrics.phases.approval.durationMs).toBeGreaterThan(0);
      expect(metrics.phases.remediation.durationMs).toBeGreaterThan(0);
      expect(metrics.phases.verification.durationMs).toBeGreaterThan(0);
      expect(metrics.totalDurationMs).toBeGreaterThan(0);

      // Formally asserts synthetic mock flag and deferral to CO-107
      expect(metrics.isSyntheticMock).toBe(true);
      expect(metrics.benchmarkDeferredToCO107).toBe(true);
    });
  });

  describe("CO-027 & CO-028: Multi-Cycle Repeatable Scenario Reset & E2E Validation", () => {
    it("executes 3 back-to-back reset-to-resolution cycles with identical clean behavior", async () => {
      for (let cycle = 1; cycle <= 3; cycle++) {
        // Step A: Inject controlled failure
        envManager.injectFailure();
        expect(envManager.getHealthStatus().status).toBe("CRITICAL");

        // Step B: Reset scenario to baseline
        const reset = envManager.resetScenario();
        expect(reset.success).toBe(true);

        // Step C: Verify clean recovery
        const recovery = await verificationService.verifyRecovery();
        expect(recovery.recovered).toBe(true);

        // Step D: Confirm teardown - zero untracked project-tagged resources
        const teardown = envManager.verifyTeardown([]);
        expect(teardown.clean).toBe(true);
        expect(teardown.orphanedResources).toHaveLength(0);
      }
    });

    it("runs complete end-to-end product demo workflow twice back-to-back", async () => {
      for (let run = 1; run <= 2; run++) {
        // 1. Incident Trigger
        envManager.injectFailure();
        const incidentPayload = envManager.createIncidentPayload();
        expect(incidentPayload.severity).toBe("CRITICAL");

        // 2. Start Investigation with Mock Agent Adapter
        const session = await mockAdapter.start({
          tenantId,
          agentId,
          scenarioId: "ecs-image-pull-failure",
          incidentContext: incidentPayload as unknown as Record<string, unknown>
        });
        expect(session.status).toBe("ACTIVE");

        // 3. Drive 6-step read-only investigation
        const rootCause = (await mockAdapter.runInvestigation(session.sessionId)) as any;
        expect(rootCause.finding).toBe("ContainerImageNotFound");
        expect(rootCause.evidenceIds).toContain("ev_ecs_stopped_task_error");

        // 4. Propose Remediation & Policy Gate
        const proposal = await mockAdapter.proposeRemediation(session.sessionId);
        expect(proposal.status).toBe("AWAITING_APPROVAL");

        // 5. Create and Sign Human Approval (Ed25519)
        const approval = await approvalService.createApprovalRequest({
          tenantId,
          agentId,
          toolName: "aws_ecs_rollback_service",
          rawPayload: {
            cluster: "cloudops-demo-cluster",
            service: "checkout-service",
            targetTaskDefinition: "checkout-service:1"
          }
        });

        const signedAt = new Date();
        const sig = OperatorSignatureService.signApproval(
          approval.id,
          approval.operationPayloadHash,
          signedAt.getTime(),
          operatorKeyPair.privateKeyPem
        );

        await approvalService.approve(tenantId, approval.id, {
          reviewedBy: "op_sre_demo",
          signature: sig,
          publicKeyPem: operatorKeyPair.publicKeyPem,
          signedAt
        });

        // 6. Execute Remediation
        await approvalService.executeApproval(tenantId, approval.id, async () => {
          envManager.resetScenario();
          return { rolledBack: true };
        });

        // 7. Post-Remediation Verification
        const recovery = await verificationService.verifyRecovery();
        expect(recovery.recovered).toBe(true);

        // 8. Confirm Teardown
        const teardown = envManager.verifyTeardown([]);
        expect(teardown.clean).toBe(true);
      }
    });
  });
});
