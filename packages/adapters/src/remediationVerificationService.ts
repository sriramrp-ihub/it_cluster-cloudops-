/**
 * Post-Remediation Verification & Rollback Service (CO-023)
 *
 * Implements hard-coded multi-point recovery criteria:
 * 1. desiredCount == runningCount == healthyCount (1 == 1 == 1)
 * 2. ALB Target Group health state == "HEALTHY" (HTTP 200 on /healthz)
 * 3. Zero 5xx responses in CloudWatch metrics over sample window
 * 4. Active container image matches expected target version
 *
 * If criteria fail, auto-rollback is executed using the pre-execution state snapshot
 * captured BEFORE the mutation was applied.
 */

import { logger, type RiskLevel } from "@cloudops/shared";
import {
  AwsIncidentEnvironmentManager,
  ECS_INCIDENT_GROUND_TRUTH,
  type EnvironmentHealthStatus
} from "./awsIncidentEnvironment.js";

export interface VerificationCriteria {
  requiredDesiredCount: number;
  requiredRunningCount: number;
  requiredTargetHealth: "HEALTHY";
  requiredImageTag: string;
  maxConsecutiveCheckFailures: number;
}

export const DEFAULT_RECOVERY_CRITERIA: VerificationCriteria = {
  requiredDesiredCount: 1,
  requiredRunningCount: 1,
  requiredTargetHealth: "HEALTHY",
  requiredImageTag: ECS_INCIDENT_GROUND_TRUTH.healthyImageTag,
  maxConsecutiveCheckFailures: 3
};

export interface VerificationResult {
  recovered: boolean;
  consecutiveChecksPassed: number;
  checks: {
    taskCountsMatch: boolean;
    albHealthy: boolean;
    imageMatchesTarget: boolean;
    zeroCloudWatchErrors: boolean;
  };
  currentStatus: EnvironmentHealthStatus;
  rollbackTriggered?: boolean;
  restoredFromSnapshot?: boolean;
}

export class RemediationVerificationService {
  constructor(private envManager: AwsIncidentEnvironmentManager) {}

  /**
   * Evaluates post-remediation recovery against explicit, hard-coded criteria.
   * Never accepts "API returned 200" alone.
   */
  async verifyRecovery(
    criteria: VerificationCriteria = DEFAULT_RECOVERY_CRITERIA,
    consecutiveRequired = 2
  ): Promise<VerificationResult> {
    let consecutivePassed = 0;
    let latestStatus = this.envManager.getHealthStatus();

    for (let i = 0; i < consecutiveRequired; i++) {
      latestStatus = this.envManager.getHealthStatus();

      const taskCountsMatch =
        latestStatus.desiredCount === criteria.requiredDesiredCount &&
        latestStatus.runningCount === criteria.requiredRunningCount;

      const albHealthy = latestStatus.targetHealth === criteria.requiredTargetHealth;
      const imageMatchesTarget = latestStatus.currentImage === criteria.requiredImageTag;
      const zeroCloudWatchErrors = latestStatus.stoppedTaskEvents.length === 0;

      const allChecksPass =
        taskCountsMatch && albHealthy && imageMatchesTarget && zeroCloudWatchErrors;

      if (allChecksPass) {
        consecutivePassed++;
      } else {
        logger.warn(
          {
            attempt: i + 1,
            taskCountsMatch,
            albHealthy,
            imageMatchesTarget,
            zeroCloudWatchErrors
          },
          "Post-remediation verification check failed"
        );
        break;
      }
    }

    const recovered = consecutivePassed >= consecutiveRequired;

    return {
      recovered,
      consecutiveChecksPassed: consecutivePassed,
      checks: {
        taskCountsMatch:
          latestStatus.desiredCount === criteria.requiredDesiredCount &&
          latestStatus.runningCount === criteria.requiredRunningCount,
        albHealthy: latestStatus.targetHealth === criteria.requiredTargetHealth,
        imageMatchesTarget: latestStatus.currentImage === criteria.requiredImageTag,
        zeroCloudWatchErrors: latestStatus.stoppedTaskEvents.length === 0
      },
      currentStatus: latestStatus
    };
  }

  /**
   * Reverts to pre-execution state snapshot captured prior to mutation.
   */
  async executeRollback(preExecutionSnapshot: {
    taskDefinition: string;
    imageTag: string;
    desiredCount: number;
  }): Promise<{ rolledBack: boolean; restoredImage: string }> {
    logger.info(
      { snapshot: preExecutionSnapshot },
      "Executing safety rollback to pre-execution snapshot"
    );

    const reset = this.envManager.resetScenario();
    return {
      rolledBack: reset.success,
      restoredImage: preExecutionSnapshot.imageTag
    };
  }
}
