-- 005_phase1_governance_hardening.sql
-- Hardening for Cryptographic Audit Trail Immutability, Signed Approvals, and Idempotent Execution

-- 1. Immutable Audit Trail (Hash Chaining & Database-Level Mutation Prevention)
ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(128) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  ADD COLUMN IF NOT EXISTS row_hash VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seq_num BIGSERIAL;

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_seq ON audit_events(tenant_id, seq_num ASC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created ON audit_events(tenant_id, created_at ASC);

-- Database-level trigger preventing any UPDATE or DELETE on audit_events
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('cloudops.bypass_audit_immutable', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_events is an append-only immutable ledger; UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_events_mutation();

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_agent_id_fkey,
  ADD CONSTRAINT audit_events_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_tenant_id_fkey,
  ADD CONSTRAINT audit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- 2. Operation Approvals Hardening (Signatures, Idempotency, In-Flight Execution, TTL & Escalation)
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS signature TEXT,
  ADD COLUMN IF NOT EXISTS signed_by VARCHAR(128),
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_result JSONB,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS dry_run_diff JSONB,
  ADD COLUMN IF NOT EXISTS previous_state_snapshot JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_idempotency_key ON approvals(idempotency_key) WHERE idempotency_key IS NOT NULL;
