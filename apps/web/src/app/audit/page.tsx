import React from "react";
import Link from "next/link";

export default function AuditPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Header */}
      <div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: "var(--near-black-ink)",
              background: "#edece9",
              border: "1px solid var(--warm-gray-border)",
              padding: "2px 7px",
              borderRadius: "var(--radius-sm)",
              textTransform: "uppercase"
            }}
          >
            Phase 7 Security Ledger
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
            BACKEND QUERY API DEPENDENCY
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Tamper-Evident Audit Ledger
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Append-only immutable audit trail recording all operator and agent actions with mandatory secret redaction.
        </p>
      </div>

      {/* Contract & Schema Card */}
      <div className="harvey-card" style={{ borderLeft: "4px solid var(--near-black-ink)" }}>
        <h3 className="panel-title" style={{ marginBottom: "8px" }}>
          Backend Reality: Append-Only Recording Active in PostgreSQL
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          The backend actively inserts immutable records into table <code className="code-inline">audit_events</code> during invite creation, join requests, operator approvals, bootstrap claims, and Gateway sessions. Plaintext secrets, tokens, and hashes are strictly excluded.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Table: audit_events
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Columns: <code className="code-inline">id</code>, <code className="code-inline">tenant_id</code>, <code className="code-inline">agent_id</code>, <code className="code-inline">event_type</code>, <code className="code-inline">actor_type</code>, <code className="code-inline">actor_id</code>, <code className="code-inline">payload</code>, <code className="code-inline">created_at</code>.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Backend Dependency: Query API
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              A paginated REST query endpoint (<code className="code-inline">GET /v1/audit-events</code>) is required to stream these historical records to this frontend table.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Zero Secret Exposure
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Audit payloads strictly log event metadata and entity identifiers, with zero raw passwords, bearer tokens, or cloud secrets.
            </p>
          </div>
        </div>
      </div>

      {/* Exemplar Schema Representation */}
      <div className="harvey-card">
        <h3 className="panel-title" style={{ marginBottom: "12px" }}>
          Audit Event Record Architecture
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          Example event structure stored in PostgreSQL:
        </p>

        <div className="code-container">
{`{
  "id": "evt_7f8a9b2c3d4e",
  "tenantId": "ten_default_tenant",
  "actorType": "OPERATOR",
  "actorId": "op_admin_operator",
  "eventType": "JOIN_REQUEST_APPROVED",
  "agentId": "ag_9a8b7c6d5e4f",
  "payload": {
    "joinRequestId": "jr_1a2b3c4d",
    "agentName": "production-worker-01",
    "agentType": "hermes"
  },
  "createdAt": "2026-09-05T08:45:12.000Z"
}`}
        </div>
      </div>
    </div>
  );
}
