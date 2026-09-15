-- CloudOps Migration 002: Agent Onboarding Refinements
-- Adds agent link to join requests, tenant scoping to claim credentials,
-- and duplicate join request prevention constraints.

-- 1. Add agent_id link to agent_join_requests
ALTER TABLE agent_join_requests
ADD COLUMN IF NOT EXISTS agent_id VARCHAR(64) REFERENCES agents(id);

CREATE INDEX IF NOT EXISTS idx_agent_join_requests_agent_id ON agent_join_requests(agent_id);

-- 2. Add tenant_id to agent_claim_credentials for explicit tenant isolation
ALTER TABLE agent_claim_credentials
ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_agent_claim_credentials_tenant_id ON agent_claim_credentials(tenant_id);

-- 3. Prevent duplicate active join requests per invite
-- Ensures exactly one active (PENDING_APPROVAL or APPROVED) join request per onboarding invite
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_join_request_per_invite
ON agent_join_requests(invite_id)
WHERE status IN ('PENDING_APPROVAL', 'APPROVED');
