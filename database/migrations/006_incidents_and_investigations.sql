-- CloudOps Migration 006: Incidents, Investigations, and Evidence Schema (CO-014)
-- Implements multi-tenant incident intake, investigation sessions, evidence tracking, and audit indexing.

CREATE TABLE IF NOT EXISTS incidents (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  account_id VARCHAR(128) NOT NULL,
  region VARCHAR(64) NOT NULL,
  service VARCHAR(255) NOT NULL,
  resource_id VARCHAR(512) NOT NULL,
  severity VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  alert_description TEXT NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(64) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created ON incidents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status ON incidents(tenant_id, status);

CREATE TABLE IF NOT EXISTS investigations (
  id VARCHAR(64) PRIMARY KEY,
  incident_id VARCHAR(64) NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id VARCHAR(64) REFERENCES agents(id),
  session_id VARCHAR(64),
  status VARCHAR(64) NOT NULL DEFAULT 'INITIALIZING',
  root_cause JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_investigations_incident ON investigations(incident_id);
CREATE INDEX IF NOT EXISTS idx_investigations_tenant_status ON investigations(tenant_id, status);

CREATE TABLE IF NOT EXISTS incident_evidence (
  id VARCHAR(64) PRIMARY KEY,
  incident_id VARCHAR(64) NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  investigation_id VARCHAR(64) REFERENCES investigations(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source VARCHAR(128) NOT NULL,
  resource VARCHAR(512) NOT NULL,
  observation TEXT NOT NULL,
  severity VARCHAR(64) NOT NULL DEFAULT 'INFO',
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_evidence_incident ON incident_evidence(incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_incident_evidence_investigation ON incident_evidence(investigation_id);
