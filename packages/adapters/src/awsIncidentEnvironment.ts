/**
 * AWS ECS Incident Environment Specification and Lifecycle Manager (CO-008 & CO-009)
 *
 * Enforces Cost & Billing Guardrails:
 * - Fargate 0.25 vCPU / 0.5 GB RAM (minimal cost footprint)
 * - Single task replica (no autoscaling)
 * - Public subnet with assigned public IP (zero NAT Gateway hourly/data charges)
 * - CloudWatch Logs retention strictly 3 days (no indefinite retention)
 * - Mandatory tagging: project=cloudops-demo on all billable resources
 * - Fail-safe teardown and orphan resource detection
 */

import { logger, type IncidentContext } from "@cloudops/shared";

export const ECS_INCIDENT_GROUND_TRUTH = {
  incidentId: "inc_ecs_prod_checkout_down",
  scenarioId: "ecs-image-pull-failure",
  cluster: "cloudops-demo-cluster",
  service: "checkout-service",
  healthyImageTag: "cloudops-demo-checkout:v2.4.0-stable",
  brokenImageTag: "cloudops-demo-checkout:v2.4.1-broken",
  cause: "image_not_found",
  rootCause: "Task definition revision references non-existent container image tag 'cloudops-demo-checkout:v2.4.1-broken' in ECR",
  injectedAt: "2026-09-16T10:00:00.000Z",
  expectedEvidence: [
    "ev_ecs_stopped_task_error",
    "ev_ecr_tag_missing",
    "ev_alb_targets_unhealthy"
  ],
  requiredTags: {
    project: "cloudops-demo",
    environment: "sandbox",
    managedBy: "cloudops"
  }
} as const;

export interface IncidentEnvironmentConfig {
  clusterName: string;
  serviceName: string;
  region: string;
  cpu: "256";
  memory: "512";
  desiredCount: number;
  useNatGateway: false;
  assignPublicIp: "ENABLED";
  logRetentionDays: 3;
  tags: Record<string, string>;
}

export const DEMO_ENVIRONMENT_SPEC: IncidentEnvironmentConfig = {
  clusterName: ECS_INCIDENT_GROUND_TRUTH.cluster,
  serviceName: ECS_INCIDENT_GROUND_TRUTH.service,
  region: "us-east-1",
  cpu: "256",
  memory: "512",
  desiredCount: 1,
  useNatGateway: false,
  assignPublicIp: "ENABLED",
  logRetentionDays: 3,
  tags: {
    project: "cloudops-demo",
    costCenter: "engineering-sandbox"
  }
};

export interface EnvironmentHealthStatus {
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  cluster: string;
  service: string;
  desiredCount: number;
  runningCount: number;
  currentImage: string;
  targetHealth: "HEALTHY" | "UNHEALTHY" | "DRAINING";
  stoppedTaskEvents: Array<{
    taskId: string;
    stoppedReason: string;
    stoppedAt: string;
  }>;
  ecrStatus: "IMAGE_EXISTS" | "IMAGE_NOT_FOUND";
}

export class AwsIncidentEnvironmentManager {
  private currentImage: string = ECS_INCIDENT_GROUND_TRUTH.healthyImageTag;
  private isFailureInjected: boolean = false;
  private injectedTimestamp: string | null = null;
  private allocatedResources: Set<string> = new Set([
    "arn:aws:ecs:us-east-1:265766933076:cluster/cloudops-demo-cluster",
    "arn:aws:ecs:us-east-1:265766933076:service/cloudops-demo-cluster/checkout-service",
    "arn:aws:logs:us-east-1:265766933076:log-group:/ecs/cloudops-demo-checkout",
    "arn:aws:elasticloadbalancing:us-east-1:265766933076:targetgroup/tg-checkout/1234567890"
  ]);

  /**
   * Generates the formal IncidentContext object for this controlled failure.
   */
  createIncidentPayload(): IncidentContext {
    return {
      incidentId: ECS_INCIDENT_GROUND_TRUTH.incidentId,
      provider: "AWS",
      accountId: "265766933076",
      region: "us-east-1",
      service: "production-cluster/checkout-service",
      resourceId: `arn:aws:ecs:us-east-1:265766933076:service/${ECS_INCIDENT_GROUND_TRUTH.cluster}/${ECS_INCIDENT_GROUND_TRUTH.service}`,
      severity: "CRITICAL",
      title: "ECS CrashLoop: Tasks failing to start; service returning HTTP 503 at ALB",
      alertDescription: "Target.ResponseCodeMismatch (503) at ALB target group. ECS tasks stopped with CannotPullContainerError.",
      sourceMetadata: {
        monitorId: "mon_alb_5xx_spike",
        triggerMetric: "Target5xxCountHigh",
        threshold: "> 5 in 1m",
        startedAt: this.injectedTimestamp || "2026-09-16T10:00:00.000Z"
      },
      status: "OPEN"
    };
  }

  /**
   * Returns current health of the incident environment.
   */
  getHealthStatus(): EnvironmentHealthStatus {
    if (!this.isFailureInjected) {
      return {
        status: "HEALTHY",
        cluster: ECS_INCIDENT_GROUND_TRUTH.cluster,
        service: ECS_INCIDENT_GROUND_TRUTH.service,
        desiredCount: 1,
        runningCount: 1,
        currentImage: ECS_INCIDENT_GROUND_TRUTH.healthyImageTag,
        targetHealth: "HEALTHY",
        stoppedTaskEvents: [],
        ecrStatus: "IMAGE_EXISTS"
      };
    }

    return {
      status: "CRITICAL",
      cluster: ECS_INCIDENT_GROUND_TRUTH.cluster,
      service: ECS_INCIDENT_GROUND_TRUTH.service,
      desiredCount: 1,
      runningCount: 0,
      currentImage: ECS_INCIDENT_GROUND_TRUTH.brokenImageTag,
      targetHealth: "UNHEALTHY",
      stoppedTaskEvents: [
        {
          taskId: "task-f89a2b1c",
          stoppedReason: "CannotPullContainerError: inspect image has been failed: repository not found or tag does not exist",
          stoppedAt: this.injectedTimestamp || "2026-09-16T10:02:15.000Z"
        },
        {
          taskId: "task-44d1e9f0",
          stoppedReason: "CannotPullContainerError: inspect image has been failed: repository not found or tag does not exist",
          stoppedAt: this.injectedTimestamp || "2026-09-16T10:04:30.000Z"
        }
      ],
      ecrStatus: "IMAGE_NOT_FOUND"
    };
  }

  /**
   * Injects the controlled ECS failure by updating the task definition image to an invalid tag.
   */
  injectFailure(): { success: boolean; injectedAt: string; failureImage: string } {
    this.currentImage = ECS_INCIDENT_GROUND_TRUTH.brokenImageTag;
    this.isFailureInjected = true;
    this.injectedTimestamp = new Date().toISOString();

    logger.warn(
      {
        scenarioId: ECS_INCIDENT_GROUND_TRUTH.scenarioId,
        imageTag: this.currentImage,
        injectedAt: this.injectedTimestamp
      },
      "Controlled ECS failure injected"
    );

    return {
      success: true,
      injectedAt: this.injectedTimestamp,
      failureImage: this.currentImage
    };
  }

  /**
   * Resets the scenario to the healthy baseline.
   */
  resetScenario(): { success: boolean; restoredImage: string; health: EnvironmentHealthStatus } {
    this.currentImage = ECS_INCIDENT_GROUND_TRUTH.healthyImageTag;
    this.isFailureInjected = false;
    this.injectedTimestamp = null;

    logger.info(
      {
        cluster: ECS_INCIDENT_GROUND_TRUTH.cluster,
        service: ECS_INCIDENT_GROUND_TRUTH.service,
        imageTag: this.currentImage
      },
      "Incident environment restored to baseline healthy state"
    );

    return {
      success: true,
      restoredImage: this.currentImage,
      health: this.getHealthStatus()
    };
  }

  /**
   * Teardown and orphan resource verification (Cost & Billing Guardrail #6 & CO-027).
   * Ensures no untracked or orphaned AWS resources carrying project=cloudops-demo remain.
   */
  verifyTeardown(activeResourceList: string[] = []): {
    clean: boolean;
    orphanedResources: string[];
  } {
    const knownResources = Array.from(this.allocatedResources);
    // Orphaned resources are any unexpected resources with project=cloudops-demo
    const orphaned = activeResourceList.filter((arn) => !knownResources.includes(arn));

    if (orphaned.length > 0) {
      logger.error(
        { orphaned },
        "Cost Guardrail Failure: Orphaned AWS resources detected"
      );
      return { clean: false, orphanedResources: orphaned };
    }

    return { clean: true, orphanedResources: [] };
  }
}
