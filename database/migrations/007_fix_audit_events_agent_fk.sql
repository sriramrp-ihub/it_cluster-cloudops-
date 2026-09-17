-- 007_fix_audit_events_agent_fk.sql
-- Drop the foreign key on audit_events(agent_id) that was triggering ON DELETE SET NULL
-- against the immutable audit_events trigger (prevent_audit_events_mutation).
-- This ensures the audit ledger remains append-only while allowing agent deletion.

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_agent_id_fkey;
