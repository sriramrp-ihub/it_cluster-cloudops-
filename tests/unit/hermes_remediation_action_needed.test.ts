import { describe, it, expect } from "vitest";
import { isMutatingRemediationTool } from "@cloudops/runtime";

/**
 * Bug fix: apps/web/src/app/investigate/page.tsx used to render an identical
 * "Human Authorization: Required (Ed25519)" prompt for EVERY finding that had
 * a `recommendedRemediation` object at all — including a healthy, LOW-risk,
 * nothing-to-fix finding whose "remediation" was really just a read-only
 * confirmation call (e.g. `aws_ecs_describe_services`). All three
 * investigation tiers in hermesAgentAdapter.ts now compute
 * `recommendedRemediation.actionNeeded` from this classifier, authoritatively
 * server-side, rather than trusting the LLM's own free-form JSON output for
 * that distinction. This file unit-tests the classifier directly, independent
 * of the LLM/CLI plumbing exercised in hermes_adaptive_investigation.test.ts
 * and hermes_swarm_investigation.test.ts.
 */
describe("isMutatingRemediationTool", () => {
  it("classifies every read-only/informational tool this product's investigation prompts offer as NOT mutating", () => {
    expect(isMutatingRemediationTool("aws_ecs_describe_services")).toBe(false);
    expect(isMutatingRemediationTool("aws_ecs_describe_clusters")).toBe(false);
    expect(isMutatingRemediationTool("aws_ecs_describe_tasks")).toBe(false);
    expect(isMutatingRemediationTool("aws_ecs_describe_stopped_tasks")).toBe(false);
    expect(isMutatingRemediationTool("aws_ecr_describe_images")).toBe(false);
    expect(isMutatingRemediationTool("aws_ecs_list_services")).toBe(false);
    expect(isMutatingRemediationTool("aws_alb_get_target_health")).toBe(false);
  });

  it("classifies every real mutation tool this product's investigation prompts offer as mutating", () => {
    expect(isMutatingRemediationTool("aws_ecs_rollback_service")).toBe(true);
    expect(isMutatingRemediationTool("aws_ecs_update_service")).toBe(true);
    expect(isMutatingRemediationTool("aws_ecs_update_service_image")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMutatingRemediationTool("AWS_ECS_DESCRIBE_SERVICES")).toBe(false);
    expect(isMutatingRemediationTool("AWS_ECS_ROLLBACK_SERVICE")).toBe(true);
  });
});
