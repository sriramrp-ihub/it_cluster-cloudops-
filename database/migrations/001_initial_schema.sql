-- CloudOps Migration 001: Initial Relational Schema
-- Implements multi-tenancy, stable agent identity, credential separation,
-- capability enforcement, approvals, runs, tool executions, and tamper-evident audit.

-- 1. Tenants (Isolation boundary)
CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Agents (Stable identity ag_<uuid>)
CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  version VARCHAR(64) NOT NULL,
  runtime_protocol VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'INVITED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant_status ON agents(tenant_id, status);

-- 3. Agent Credentials (Replaceable authentication material cred_<uuid>)
CREATE TABLE IF NOT EXISTS agent_credentials (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  credential_hash VARCHAR(128) NOT NULL UNIQUE,
  salt VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_agent_status ON agent_credentials(agent_id, status);

-- 4. Agent Sessions (Active gateway sessions sess_<uuid>)
CREATE TABLE IF NOT EXISTS agent_sessions (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  credential_id VARCHAR(64) NOT NULL REFERENCES agent_credentials(id),
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(64) NOT NULL DEFAULT 'REGISTERING',
  client_nonce VARCHAR(128) NOT NULL,
  server_nonce VARCHAR(128) NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_status ON agent_sessions(agent_id, status);

-- 5. Agent Invites (Onboarding bootstrap co_inv_...)
CREATE TABLE IF NOT EXISTS agent_invites (
  id VARCHAR(64) PRIMARY KEY,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  status VARCHAR(64) NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_invites_tenant_status ON agent_invites(tenant_id, status);

-- 6. Agent Join Requests (Declarative onboarding requests jr_<uuid>)
CREATE TABLE IF NOT EXISTS agent_join_requests (
  id VARCHAR(64) PRIMARY KEY,
  invite_id VARCHAR(64) NOT NULL REFERENCES agent_invites(id),
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  agent_name VARCHAR(255) NOT NULL,
  agent_type VARCHAR(64) NOT NULL,
  agent_version VARCHAR(64) NOT NULL,
  gateway_protocol VARCHAR(64) NOT NULL,
  endpoint VARCHAR(512),
  declared_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(64) NOT NULL DEFAULT 'PENDING_APPROVAL',
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_join_requests_invite ON agent_join_requests(invite_id, status);

-- 7. Agent Claim Credentials (Single-use bootstrap tokens co_agent_...)
CREATE TABLE IF NOT EXISTS agent_claim_credentials (
  id VARCHAR(64) PRIMARY KEY,
  join_request_id VARCHAR(64) NOT NULL REFERENCES agent_join_requests(id) ON DELETE CASCADE,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  claim_token_hash VARCHAR(128) NOT NULL UNIQUE,
  status VARCHAR(64) NOT NULL DEFAULT 'AVAILABLE',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_claim_creds_join ON agent_claim_credentials(join_request_id, status);

-- 8. Runtimes (Registered runtime types)
CREATE TABLE IF NOT EXISTS runtimes (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  protocol VARCHAR(64) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Runtime Sessions (Process/ACP session tracking)
CREATE TABLE IF NOT EXISTS runtime_sessions (
  id VARCHAR(64) PRIMARY KEY,
  runtime_id VARCHAR(64) NOT NULL REFERENCES runtimes(id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(64) NOT NULL DEFAULT 'INITIALIZING',
  pid INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminated_at TIMESTAMPTZ
);

-- 10. Capabilities (Permission catalog)
CREATE TABLE IF NOT EXISTS capabilities (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  provider VARCHAR(64) NOT NULL,
  service VARCHAR(64) NOT NULL,
  action VARCHAR(128) NOT NULL,
  risk_level VARCHAR(64) NOT NULL DEFAULT 'LOW',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Capability Grants (Agent capability grants)
CREATE TABLE IF NOT EXISTS capability_grants (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability_id VARCHAR(64) NOT NULL REFERENCES capabilities(id),
  status VARCHAR(64) NOT NULL DEFAULT 'ACTIVE',
  granted_by VARCHAR(128) NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_capability_grants_agent ON capability_grants(agent_id, status);

-- 12. Policies (Governance policy rules)
CREATE TABLE IF NOT EXISTS policies (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  condition_expression JSONB NOT NULL,
  effect VARCHAR(64) NOT NULL,
  risk_level VARCHAR(64) NOT NULL DEFAULT 'MEDIUM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Approvals (Operation-bound human approvals appr_<uuid>)
CREATE TABLE IF NOT EXISTS approvals (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  run_id VARCHAR(64),
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id),
  operation_type VARCHAR(64) NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  operation_payload_hash VARCHAR(128) NOT NULL,
  raw_payload JSONB NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'PENDING',
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approvals_agent_status ON approvals(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_payload_hash ON approvals(operation_payload_hash);

-- 14. Runs (Conversational multi-turn executions run_<uuid>)
CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id),
  session_id VARCHAR(64) REFERENCES agent_sessions(id),
  user_id VARCHAR(128),
  user_prompt TEXT NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'CREATED',
  final_response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_runs_agent_status ON runs(agent_id, status);

-- 15. Tool Executions (Granular tool calls within a run)
CREATE TABLE IF NOT EXISTS tool_executions (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id),
  tool_name VARCHAR(128) NOT NULL,
  input_payload JSONB NOT NULL,
  output_payload JSONB,
  status VARCHAR(64) NOT NULL DEFAULT 'EXECUTING',
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tool_executions_run ON tool_executions(run_id);

-- 16. Cloud Accounts (Cloud infrastructure integrations)
CREATE TABLE IF NOT EXISTS cloud_accounts (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  provider VARCHAR(64) NOT NULL,
  account_id VARCHAR(128) NOT NULL,
  role_arn VARCHAR(512),
  region VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. Audit Events (Append-only immutable audit trail)
CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  agent_id VARCHAR(64) REFERENCES agents(id),
  run_id VARCHAR(64),
  event_type VARCHAR(128) NOT NULL,
  actor_type VARCHAR(64) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created ON audit_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_agent_created ON audit_events(agent_id, created_at DESC);

-- 18. Domain Events (Real-time SSE event log evt_<uuid>)
CREATE TABLE IF NOT EXISTS domain_events (
  id VARCHAR(64) PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event_type VARCHAR(128) NOT NULL,
  sequence_number INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_domain_events_run_seq ON domain_events(run_id, sequence_number ASC);
