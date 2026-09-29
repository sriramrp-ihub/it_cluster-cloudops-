-- ADR-0008 (Governed Runtime — MCP-Only Execution Boundary), Phase A: every
-- onboarded agent gets its own isolated Hermes profile at claim time, with
-- every native toolset (terminal, file, code_execution, browser,
-- computer_use, delegation, cronjob) explicitly disabled and CloudOps's own
-- MCP SSE server (apps/api's /v1/mcp/sse) registered as its only tool
-- source. These columns record that lockdown so it can be surfaced in
-- diagnostics and independently re-verified later —
-- HermesProfileService.verifyGovernance() re-checks both invariants on
-- demand rather than trusting provisioning-time success alone to still hold.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS hermes_profile_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS governance_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS governance_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mcp_registered BOOLEAN NOT NULL DEFAULT false;

-- governance_status values (enforced in application code — see
-- @cloudops/shared's AgentGovernanceStatus — not a DB constraint, mirroring
-- the existing plain-string agents.status column's own convention):
--   PENDING     — not yet provisioned, or provisioning hasn't run
--   LOCKED_DOWN — native toolsets verified disabled AND MCP server verified
--                 registered/reachable, as of governance_verified_at
--   FAILED      — provisioning or re-verification could not confirm the
--                 lockdown; the agent must be treated as NOT governed

CREATE INDEX IF NOT EXISTS idx_agents_governance_status ON agents(governance_status);
