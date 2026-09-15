import React from "react";
import Link from "next/link";

export default function CapabilitiesPage() {
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
            Phase 5 Authorization
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
            ARCHITECTURAL CONTRACT
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Capability Catalog & Boundaries
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Dictionary of granular cloud permissions and the strict distinction between declared intent and authorized execution.
        </p>
      </div>

      {/* Contract & Schema Card */}
      <div className="harvey-card" style={{ borderLeft: "4px solid var(--near-black-ink)" }}>
        <h3 className="panel-title" style={{ marginBottom: "8px" }}>
          The Invariant Rule: Declared Capabilities ≠ Authorized Capabilities
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          When an agent joins CloudOps, it declares what operations it would like to perform. CloudOps governance grants a strict subset: <code className="code-inline">Authorized Capabilities ⊆ Declared Capabilities</code>.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Provisioned Schema: capabilities
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Permission catalog specifying provider, service, action, risk tier (LOW, MEDIUM, HIGH, CRITICAL), and action descriptions.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Provisioned Schema: capability_grants
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Agent-specific authorization grants bound to stable identity <code className="code-inline">ag_&lt;uuid&gt;</code>, reviewer ID, and revocation timestamps.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Enforcement at Gateway
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Every tool execution request evaluated deterministically against the agent&apos;s active capability profile before cloud credential dispatch.
            </p>
          </div>
        </div>
      </div>

      {/* Exemplar Capability Taxonomy */}
      <div className="harvey-card">
        <h3 className="panel-title" style={{ marginBottom: "12px" }}>
          Standard Capability Action Taxonomy
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          Reference capability definitions provisioned in the CloudOps schema:
        </p>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Capability Identifier</th>
                <th>Provider</th>
                <th>Service</th>
                <th>Risk Classification</th>
                <th>Evaluation Policy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="code-inline">aws.ecs.describe_clusters</span></td>
                <td>AWS</td>
                <td>ECS</td>
                <td><span className="status-pill registered">LOW</span></td>
                <td style={{ fontSize: "12.5px" }}>Automated Allow</td>
              </tr>
              <tr>
                <td><span className="code-inline">aws.ecs.list_tasks</span></td>
                <td>AWS</td>
                <td>ECS</td>
                <td><span className="status-pill registered">LOW</span></td>
                <td style={{ fontSize: "12.5px" }}>Automated Allow</td>
              </tr>
              <tr>
                <td><span className="code-inline">aws.ecs.stop_task</span></td>
                <td>AWS</td>
                <td>ECS</td>
                <td><span className="status-pill rejected">HIGH</span></td>
                <td style={{ fontSize: "12.5px" }}>Human Approval Required</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
