-- ADR-0007 Phase C1b (Multi-Agent Swarm): tags each onboarded agent with an
-- orchestration/routing ROLE — purely a scheduling concept for
-- resolveSwarmParticipants() (packages/runtime/src/swarmRouting.ts) to decide
-- which agents can fill which slot in a Kanban Swarm graph. This is NOT a
-- security/authorization concept: capability_tiers.rego (the PolicyEngine's
-- capability-tier classification) has zero awareness of this column and must
-- stay that way — an agent's actually-authorized actions are governed
-- entirely by its granted_capabilities, exactly as before this migration.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'generalist';

-- role values (enforced in application code — see @cloudops/shared's
-- AgentRole — not a DB CHECK constraint, mirroring the existing plain-string
-- agents.status/governance_status columns' own convention):
--   generalist   — default for every agent onboarded before/without this
--                  feature; never eligible to fill a swarm slot
--   investigator — eligible to fill a parallel-worker slot in a swarm
--   verifier     — eligible to fill the single verifier slot in a swarm
--   synthesizer  — eligible to fill the single synthesizer slot in a swarm

CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role);
