-- 008_agent_connectors.sql
-- Tracks spawned agent connector sidecars, MCP ports, SSE endpoints, and PID lifecycle

CREATE TABLE IF NOT EXISTS agent_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id),
  pid INTEGER,
  mcp_port INTEGER,
  mcp_sse_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'starting',
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  stopped_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_connectors_agent_id ON agent_connectors(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_connectors_tenant_id ON agent_connectors(tenant_id);
