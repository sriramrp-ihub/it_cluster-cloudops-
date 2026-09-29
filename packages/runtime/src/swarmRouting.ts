import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import { logger, type AgentRole } from "@cloudops/shared";
import { HermesProfileService } from "./hermesProfileService.js";

/**
 * ADR-0007 Phase C1b (Multi-Agent Swarm — orchestration model).
 */
export interface SwarmParticipant {
  agentId: string;
  hermesProfileName: string;
}

export interface SwarmEligibility {
  eligible: boolean;
  /** All freshly-governed 'investigator' agents available (>= 1 required). */
  investigators: SwarmParticipant[];
  verifier: SwarmParticipant | null;
  synthesizer: SwarmParticipant | null;
  /** Human-readable reason this tenant is NOT swarm-eligible; null when eligible. */
  reason: string | null;
}

export interface ResolveSwarmParticipantsDeps {
  db?: Kysely<DatabaseSchema> | undefined;
  hermesProfileService?: HermesProfileService | undefined;
}

const ROLE_TAGGED_ROLES: AgentRole[] = ["investigator", "verifier", "synthesizer"];

function ineligible(reason: string): SwarmEligibility {
  return { eligible: false, investigators: [], verifier: null, synthesizer: null, reason };
}

/**
 * Resolves whether a tenant currently has a role-tagged fleet capable of
 * running a Kanban Swarm investigation — at least one 'investigator', and
 * EXACTLY one 'verifier' and one 'synthesizer' — and, critically,
 * independently RE-VERIFIES governance for every candidate FRESH via
 * `HermesProfileService.verifyGovernance()` rather than trusting each
 * candidate's stored `governance_status` column alone. This mirrors the same
 * "don't trust provisioning-time success alone" principle ADR-0008 Phase A/B
 * already established for single-agent governance checks (see
 * HermesProfileService's own class doc comment) — applied here to the
 * higher-stakes swarm-eligibility decision itself, since a stale/drifted
 * LOCKED_DOWN flag on a swarm participant would otherwise let an
 * un-governed agent's Hermes profile run unattended tool-calling turns.
 *
 * The stored `governance_status` column IS still read, but only as a cheap
 * pre-filter to avoid firing a live `hermes` CLI re-verification against
 * every role-tagged row regardless of whether it has any realistic chance of
 * being eligible (e.g. one that was never even provisioned). The ELIGIBILITY
 * DECISION itself is made exclusively from the fresh `verifyGovernance()`
 * result for each surviving candidate — never the stored flag.
 *
 * Every tenant that has NOT deliberately onboarded a role-tagged fleet
 * (i.e. every tenant today — `agents.role` defaults to 'generalist', see
 * database/migrations/020_agent_roles.sql) short-circuits on the very first
 * query, finding zero role-tagged rows: zero `hermes` CLI invocations, zero
 * behavior change from before this feature existed. This is deliberately
 * the FIRST check in this function, ahead of the cheap pre-filter, so it's
 * trivially true by construction rather than something that merely happens
 * to fall out of the later filters.
 */
export async function resolveSwarmParticipants(
  tenantId: string,
  deps: ResolveSwarmParticipantsDeps = {}
): Promise<SwarmEligibility> {
  const db = deps.db || getDatabase();

  const rows = await db
    .selectFrom("agents")
    .select(["id", "role", "hermes_profile_name", "governance_status"])
    .where("tenant_id", "=", tenantId)
    .where("role", "in", ROLE_TAGGED_ROLES as string[])
    .execute();

  if (rows.length === 0) {
    return ineligible(
      "No role-tagged agents (investigator/verifier/synthesizer) onboarded for this tenant — every agent defaults to 'generalist' and is never swarm-eligible."
    );
  }

  // Cheap pre-filter only — NOT the eligibility decision (see doc comment
  // above). Skips a wasted CLI round-trip for a candidate that was never
  // even provisioned, or that's already on record as drifted/failed.
  const candidates = rows.filter((r) => Boolean(r.hermes_profile_name) && r.governance_status === "LOCKED_DOWN");

  if (candidates.length === 0) {
    return ineligible(
      "Role-tagged agents exist for this tenant, but none are on record as LOCKED_DOWN with a provisioned Hermes profile."
    );
  }

  const hermesProfileService = deps.hermesProfileService || new HermesProfileService({ db });

  const verified: Array<{ id: string; role: string; hermesProfileName: string }> = [];
  for (const row of candidates) {
    let result;
    try {
      result = await hermesProfileService.verifyGovernance(tenantId, row.id);
    } catch (err: any) {
      logger.warn(
        { tenantId, agentId: row.id, role: row.role, err },
        "Swarm eligibility: fresh governance re-verification threw — excluding this candidate (fail closed)"
      );
      continue;
    }
    if (result.governanceStatus === "LOCKED_DOWN" && result.hermesProfileName) {
      verified.push({ id: row.id, role: row.role, hermesProfileName: result.hermesProfileName });
    } else {
      logger.warn(
        { tenantId, agentId: row.id, role: row.role, errors: result.errors },
        "Swarm eligibility: candidate agent failed FRESH governance re-verification (stored flag alone was not trusted) — excluded from this swarm"
      );
    }
  }

  const investigators = verified
    .filter((v) => v.role === "investigator")
    .map((v) => ({ agentId: v.id, hermesProfileName: v.hermesProfileName }));
  const verifiers = verified.filter((v) => v.role === "verifier");
  const synthesizers = verified.filter((v) => v.role === "synthesizer");

  if (investigators.length < 1) {
    return ineligible("No freshly-governed 'investigator' agent available after live re-verification.");
  }
  if (verifiers.length !== 1) {
    return ineligible(`Expected exactly one freshly-governed 'verifier' agent, found ${verifiers.length}.`);
  }
  if (synthesizers.length !== 1) {
    return ineligible(`Expected exactly one freshly-governed 'synthesizer' agent, found ${synthesizers.length}.`);
  }

  return {
    eligible: true,
    investigators,
    verifier: { agentId: verifiers[0]!.id, hermesProfileName: verifiers[0]!.hermesProfileName },
    synthesizer: { agentId: synthesizers[0]!.id, hermesProfileName: synthesizers[0]!.hermesProfileName },
    reason: null
  };
}
