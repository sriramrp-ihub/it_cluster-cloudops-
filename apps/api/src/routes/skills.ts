import type { FastifyPluginAsync } from "fastify";
import { requireOperatorAuth } from "../middleware/auth.js";

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  builtIn: boolean;
}

export const CANONICAL_SKILLS: Skill[] = [
  {
    id: "skill_investigation_workflow",
    name: "Autonomous Incident Investigation",
    description: "Standardized multi-step root cause analysis for ECS crashloops, OOMs, and latency spikes",
    category: "incident_response",
    builtIn: true
  },
  {
    id: "skill_ecs_diagnostics",
    name: "AWS ECS Diagnostics & Remediation",
    description: "Inspect task exit codes, stop reasons, container health checks, and task definitions",
    category: "cloud_ops",
    builtIn: true
  },
  {
    id: "skill_cloudwatch_telemetry",
    name: "CloudWatch Anomaly & Telemetry Analysis",
    description: "Analyze metric spikes, alarm thresholds, and CloudWatch log groups for error patterns",
    category: "observability",
    builtIn: true
  },
  {
    id: "skill_rollback_orchestration",
    name: "Zero-Downtime Service Rollback",
    description: "Safely revert ECS service task definitions to prior stable snapshot with dry-run verification",
    category: "deployments",
    builtIn: false
  },
  {
    id: "skill_defenseclaw_security",
    name: "DefenseClaw Fencing & Governance",
    description: "Enforce OPA Rego policies, budget caps, region isolation, and Ed25519 mutation approval",
    category: "security",
    builtIn: false
  }
];

export const skillRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/skills
   * Returns skills library with built-in runtime and company skills.
   */
  fastify.get("/v1/skills", { preHandler: [requireOperatorAuth] }, async (_request, reply) => {
    return reply.status(200).send({
      skills: CANONICAL_SKILLS
    });
  });
};
