-- ADR-0007 Phase C1b (Multi-Agent Swarm): additive, nullable self-reference
-- so a swarm worker/verifier/synthesizer's own `runs` row (recorded under
-- ITS OWN agent_id, preserving per-agent audit attribution) can be linked
-- back to the outer investigation's run that triggered the swarm. NULL for
-- every run that isn't part of a swarm (i.e. every run before this
-- migration, and every non-swarm run after it) — purely additive, no
-- behavior change for existing callers of RunService.createRun().
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS parent_run_id VARCHAR(64) REFERENCES runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id ON runs(parent_run_id);
