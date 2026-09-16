import { describe, it, expect, beforeEach } from "vitest";
import {
  AwsIncidentEnvironmentManager,
  ECS_INCIDENT_GROUND_TRUTH,
  DEMO_ENVIRONMENT_SPEC
} from "@cloudops/adapters";
import {
  MockAgentAdapter,
  type AgentToolCall,
  type AgentToolResult
} from "@cloudops/runtime";
import {
  validateIncidentContext,
  ValidationError,
  type IncidentEvent
} from "@cloudops/shared";
import { DefenseClawGuardrailService } from "@cloudops/security";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("V1: Deterministic Incident Environment & Read-Only Investigation (CO-008 -> CO-012)", () => {
  let envManager: AwsIncidentEnvironmentManager;
  let adapter: MockAgentAdapter;
  let guardrailService: DefenseClawGuardrailService;

  beforeEach(() => {
    envManager = new AwsIncidentEnvironmentManager();
    adapter = new MockAgentAdapter({
      fixturesDir: path.resolve(__dirname, "../../packages/runtime/fixtures")
    });
    guardrailService = new DefenseClawGuardrailService();
  });

  describe("CO-008: ECS Incident Environment & Cost Guardrails", () => {
    it("proves demo environment specification strictly satisfies AWS cost & billing guardrails", () => {
      // Guardrail #2: Smallest available size (0.25 vCPU / 0.5 GB RAM)
      expect(DEMO_ENVIRONMENT_SPEC.cpu).toBe("256");
      expect(DEMO_ENVIRONMENT_SPEC.memory).toBe("512");
      expect(DEMO_ENVIRONMENT_SPEC.desiredCount).toBe(1);

      // Guardrail #3: Avoid NAT Gateway charges - public IP enabled instead
      expect(DEMO_ENVIRONMENT_SPEC.useNatGateway).toBe(false);
      expect(DEMO_ENVIRONMENT_SPEC.assignPublicIp).toBe("ENABLED");

      // Guardrail #4: Short CloudWatch Logs retention (3 days, never indefinite)
      expect(DEMO_ENVIRONMENT_SPEC.logRetentionDays).toBe(3);

      // Guardrail #5: Tagged with project=cloudops-demo
      expect(DEMO_ENVIRONMENT_SPEC.tags.project).toBe("cloudops-demo");
    });

    it("verifies documented baseline healthy state before failure injection", () => {
      const health = envManager.getHealthStatus();
      expect(health.status).toBe("HEALTHY");
      expect(health.cluster).toBe("cloudops-demo-cluster");
      expect(health.service).toBe("checkout-service");
      expect(health.desiredCount).toBe(1);
      expect(health.runningCount).toBe(1);
      expect(health.currentImage).toBe(ECS_INCIDENT_GROUND_TRUTH.healthyImageTag);
      expect(health.targetHealth).toBe("HEALTHY");
      expect(health.ecrStatus).toBe("IMAGE_EXISTS");
      expect(health.stoppedTaskEvents).toHaveLength(0);
    });
  });

  describe("CO-009: Controlled ECS Failure & Ground Truth", () => {
    it("deliberately injects container image failure and observes failure state", () => {
      const injectionResult = envManager.injectFailure();
      expect(injectionResult.success).toBe(true);
      expect(injectionResult.failureImage).toBe(ECS_INCIDENT_GROUND_TRUTH.brokenImageTag);

      const health = envManager.getHealthStatus();
      expect(health.status).toBe("CRITICAL");
      expect(health.runningCount).toBe(0);
      expect(health.targetHealth).toBe("UNHEALTHY");
      expect(health.ecrStatus).toBe("IMAGE_NOT_FOUND");
      expect(health.stoppedTaskEvents.length).toBeGreaterThan(0);
      expect(health.stoppedTaskEvents[0].stoppedReason).toContain("CannotPullContainerError");
    });

    it("resets scenario to baseline healthy state reliably", () => {
      envManager.injectFailure();
      const resetResult = envManager.resetScenario();

      expect(resetResult.success).toBe(true);
      expect(resetResult.restoredImage).toBe(ECS_INCIDENT_GROUND_TRUTH.healthyImageTag);
      expect(resetResult.health.status).toBe("HEALTHY");
      expect(resetResult.health.runningCount).toBe(1);
      expect(resetResult.health.targetHealth).toBe("HEALTHY");
    });

    it("records ground-truth root cause in an unambiguous, machine-checkable schema", () => {
      expect(ECS_INCIDENT_GROUND_TRUTH.cause).toBe("image_not_found");
      expect(ECS_INCIDENT_GROUND_TRUTH.cluster).toBe("cloudops-demo-cluster");
      expect(ECS_INCIDENT_GROUND_TRUTH.service).toBe("checkout-service");
      expect(ECS_INCIDENT_GROUND_TRUTH.expectedEvidence).toContain("ev_ecs_stopped_task_error");
      expect(ECS_INCIDENT_GROUND_TRUTH.expectedEvidence).toContain("ev_ecr_tag_missing");
      expect(ECS_INCIDENT_GROUND_TRUTH.expectedEvidence).toContain("ev_alb_targets_unhealthy");
    });

    it("enforces Cost Guardrail #6: teardown check catches orphaned project-tagged resources", () => {
      // Clean state
      const cleanCheck = envManager.verifyTeardown([]);
      expect(cleanCheck.clean).toBe(true);
      expect(cleanCheck.orphanedResources).toHaveLength(0);

      // Orphaned resource detected
      const orphanCheck = envManager.verifyTeardown([
        "arn:aws:ecs:us-east-1:265766933076:service/cloudops-demo-cluster/untracked-orphan-task"
      ]);
      expect(orphanCheck.clean).toBe(false);
      expect(orphanCheck.orphanedResources).toContain(
        "arn:aws:ecs:us-east-1:265766933076:service/cloudops-demo-cluster/untracked-orphan-task"
      );
    });
  });

  describe("CO-010: Incident Input Contract & Fail-Closed Validation", () => {
    it("fails closed on malformed or incomplete incident payload", () => {
      const incompleteInputs = [
        {},
        { incidentId: "inc-1" },
        { incidentId: "inc-1", provider: "AWS" },
        {
          incidentId: "inc-1",
          provider: "AWS",
          accountId: "265766933076",
          region: "us-east-1",
          service: "checkout",
          resourceId: "arn:aws:ecs:...",
          severity: "INVALID_SEVERITY", // invalid severity
          alertDescription: "Alert"
        }
      ];

      for (const input of incompleteInputs) {
        const res = validateIncidentContext(input);
        expect(res.valid).toBe(false);
        expect(res.errors?.length).toBeGreaterThan(0);
      }
    });

    it("Agent Adapter refuses to start investigation with malformed incident context", async () => {
      await expect(
        adapter.start({
          tenantId: "ten_001",
          agentId: "ag_mock_001",
          scenarioId: "investigation",
          incidentContext: {
            incidentId: "inc_invalid"
            // Missing all other mandatory fields
          }
        })
      ).rejects.toThrow(ValidationError);
    });

    it("Agent Adapter successfully starts when provided valid formal incident context", async () => {
      const validPayload = envManager.createIncidentPayload();
      const session = await adapter.start({
        tenantId: "ten_001",
        agentId: "ag_mock_001",
        scenarioId: "ecs-image-pull-failure",
        incidentContext: validPayload as unknown as Record<string, unknown>
      });

      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.status).toBe("ACTIVE");
    });
  });

  describe("CO-011: Investigation Workflow & Read-Only Policy Boundary", () => {
    it("verifies investigation instructions SOP file exists and defines 6 inspection stages", () => {
      const skillPath = path.resolve(__dirname, "../../skills/investigation_workflow.md");
      expect(fs.existsSync(skillPath)).toBe(true);

      const skillContent = fs.readFileSync(skillPath, "utf8");
      expect(skillContent).toContain("aws_ecs_describe_clusters");
      expect(skillContent).toContain("aws_ecs_list_tasks");
      expect(skillContent).toContain("aws_ecs_describe_stopped_tasks");
      expect(skillContent).toContain("aws_cloudwatch_get_metric_data");
      expect(skillContent).toContain("aws_alb_get_target_health");
      expect(skillContent).toContain("aws_ecr_describe_images");
      expect(skillContent).toContain("Read-Only Identity Boundary");
    });

    it("strictly blocks mutating write actions during investigation at the policy/identity layer", async () => {
      // Investigation role capabilities (read-only baseline)
      const investigationCapabilities = [
        "aws.ecs.describe_clusters",
        "aws.ecs.list_tasks",
        "aws.ecs.describe_stopped_tasks",
        "aws.cloudwatch.get_metric_data",
        "aws.alb.get_target_health",
        "aws.ecr.describe_images"
      ];

      // Mutating actions that must be rejected
      const forbiddenWriteCalls = [
        "aws_ecs_update_service",
        "aws_ecs_delete_service",
        "aws_ecs_stop_task",
        "aws_ecs_rollback_service"
      ];

      for (const toolName of forbiddenWriteCalls) {
        const decision = await guardrailService.inspectToolCall({
          agentId: "ag_mock_001",
          tenantId: "ten_001",
          toolName,
          arguments: { cluster: "cloudops-demo-cluster", service: "checkout-service" },
          grantedCapabilities: investigationCapabilities
        });

        expect(decision.allowed).toBe(false);
        expect(decision.action).toBe("BLOCK");
        expect(decision.guardrailViolations.some((v) => v.includes("CAPABILITY_BOUNDARY_VIOLATION"))).toBe(true);
      }
    });

    it("streams normalized events (STEP, EVIDENCE, ROOT_CAUSE) during investigation loop", async () => {
      const validPayload = envManager.createIncidentPayload();
      const session = await adapter.start({
        tenantId: "ten_001",
        agentId: "ag_mock_001",
        scenarioId: "ecs-image-pull-failure",
        incidentContext: validPayload as unknown as Record<string, unknown>
      });

      const events: string[] = [];
      adapter.onEvent(session.sessionId, (evt) => {
        events.push(evt.type);
      });

      await adapter.runInvestigation(session.sessionId);

      expect(events).toContain("STEP");
      expect(events).toContain("EVIDENCE");
      expect(events).toContain("ROOT_CAUSE");
      expect(events.filter((t) => t === "STEP").length).toBe(6);
      expect(events.filter((t) => t === "EVIDENCE").length).toBe(6);
    });
  });

  describe("CO-012: Evidence & Root-Cause Output + Pipeline Accuracy Scoring", () => {
    it("asserts mock investigation output matches machine-checkable ground truth and links evidence IDs", async () => {
      const validPayload = envManager.createIncidentPayload();
      const session = await adapter.start({
        tenantId: "ten_001",
        agentId: "ag_mock_001",
        scenarioId: "ecs-image-pull-failure",
        incidentContext: validPayload as unknown as Record<string, unknown>
      });

      const rootCause = (await adapter.runInvestigation(session.sessionId)) as {
        type: string;
        finding: string;
        rootCause: string;
        confidence: number;
        evidenceIds: string[];
        affectedResources: string[];
        recommendedRemediation: {
          toolName: string;
          arguments: Record<string, unknown>;
          riskLevel: string;
          requiresApproval: boolean;
        };
      };

      // Pipeline Accuracy Score against Ground Truth
      expect(rootCause.finding).toBe("ContainerImageNotFound");
      expect(rootCause.confidence).toBeGreaterThanOrEqual(0.95);

      // Root cause conclusion must link to supporting evidence IDs
      expect(rootCause.evidenceIds.length).toBeGreaterThanOrEqual(1);
      for (const expectedEv of ECS_INCIDENT_GROUND_TRUTH.expectedEvidence) {
        expect(rootCause.evidenceIds).toContain(expectedEv);
      }

      // Root cause must identify affected resources
      expect(rootCause.affectedResources.length).toBeGreaterThan(0);

      // Remediation must propose action with risk level and approval requirement
      expect(rootCause.recommendedRemediation.toolName).toBe("aws_ecs_rollback_service");
      expect(rootCause.recommendedRemediation.riskLevel).toBe("HIGH");
      expect(rootCause.recommendedRemediation.requiresApproval).toBe(true);
    });
  });
});
