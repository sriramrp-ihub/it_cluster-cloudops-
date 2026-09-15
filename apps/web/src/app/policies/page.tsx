import React from "react";
import Link from "next/link";

export default function PoliciesPage() {
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
            Phase 5 Governance
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
            ARCHITECTURAL CONTRACT
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Deterministic Policy Engine
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Multi-tenant governance policies evaluating agent operational requests against conditions, environmental risk, and blast-radius rules.
        </p>
      </div>

      {/* Contract & Schema Card */}
      <div className="harvey-card" style={{ borderLeft: "4px solid var(--near-black-ink)" }}>
        <h3 className="panel-title" style={{ marginBottom: "8px" }}>
          Phase 5 Architectural Contract: Policy Evaluation
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          The policy engine deterministically resolves every operational request into one of three decisions: <code className="code-inline">ALLOW</code>, <code className="code-inline">DENY</code>, or <code className="code-inline">APPROVAL_REQUIRED</code>.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Provisioned Schema: policies
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Stores JSON-based condition expressions, tenant ownership, effect rules (ALLOW/DENY), and risk thresholds.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Deterministic Resolution
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Zero non-deterministic AI evaluation in the policy path. Policies execute purely as mathematical expressions over payload parameters.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Package: @cloudops/policy
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Pre-provisioned domain package implementing <code className="code-inline">PolicyEvaluationContext</code> and <code className="code-inline">PolicyEvaluationResult</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Honest Empty State */}
      <div className="harvey-card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--near-black-ink)", marginBottom: "8px" }}>
          Policy Engine Dormant in Phase 3
        </div>
        <p className="body-subtle" style={{ maxWidth: "540px", margin: "0 auto 20px auto" }}>
          All database tables (<code className="code-inline">policies</code>) and interfaces are ready in the monorepo. The operational policy editor and rule simulator will activate in Phase 5.
        </p>
        <Link href="/" className="btn-secondary">
          ← Return to Operational Overview
        </Link>
      </div>
    </div>
  );
}
