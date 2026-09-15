-- Phase 3: Agent Gateway & Runtime Registration Schema Additions

-- 1. Track bootstrap credential exchange to enforce single-use replay protection
ALTER TABLE agent_claim_credentials 
ADD COLUMN IF NOT EXISTS exchanged_at TIMESTAMPTZ;

-- 2. Upgrade agent_credentials for runtime credential lifecycle
ALTER TABLE agent_credentials 
ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) REFERENCES tenants(id);

ALTER TABLE agent_credentials 
ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE agent_credentials 
ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;

ALTER TABLE agent_credentials 
ADD COLUMN IF NOT EXISTS replaced_by_credential_id VARCHAR(64) REFERENCES agent_credentials(id);

CREATE INDEX IF NOT EXISTS idx_agent_credentials_tenant_status ON agent_credentials(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_hash ON agent_credentials(credential_hash);

-- 3. Upgrade agent_sessions for WebSocket sessions and disconnect tracking
ALTER TABLE agent_sessions 
ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) REFERENCES tenants(id);

ALTER TABLE agent_sessions 
ADD COLUMN IF NOT EXISTS disconnect_reason VARCHAR(255);

ALTER TABLE agent_sessions 
ADD COLUMN IF NOT EXISTS gateway_node_id VARCHAR(128);

ALTER TABLE agent_sessions 
ALTER COLUMN client_nonce DROP NOT NULL;

ALTER TABLE agent_sessions 
ALTER COLUMN server_nonce DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant ON agent_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_heartbeat ON agent_sessions(status, last_heartbeat_at);
