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
            Access Governance
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Deterministic Policy Engine
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Multi-tenant governance policies evaluating agent operational requests against conditions, environmental risk, and blast-radius rules.
        </p>
      </div>

      {/* Policy Evaluation Note: Resolves every operational request deterministically into ALLOW, DENY, or APPROVAL_REQUIRED. */}
      <div className="harvey-card" style={{ borderLeft: "4px solid var(--near-black-ink)" }}>
        <h3 className="panel-title" style={{ marginBottom: "8px" }}>
          Deterministic Policy Evaluation Architecture
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          The policy engine deterministically resolves every operational request into one of three decisions: <code className="code-inline">ALLOW</code>, <code className="code-inline">DENY</code>, or <code className="code-inline">APPROVAL_REQUIRED</code>.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Condition Expressions
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Stores condition expressions, tenant ownership, effect rules, and environmental risk thresholds.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Deterministic Evaluation
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Zero non-deterministic evaluation in the policy path. Policies execute strictly as deterministic expressions over payload parameters.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Governance Boundaries
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Fine-grained capability scopes enforce human-in-the-loop sign-off before cloud mutations execute.
            </p>
          </div>
        </div>
      </div>

      {/* Policy Rules Overview */}
      <div className="harvey-card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--near-black-ink)", marginBottom: "8px" }}>
          Active Tenant Policies Enforced
        </div>
        <p className="body-subtle" style={{ maxWidth: "540px", margin: "0 auto 20px auto" }}>
          Default security baseline active: all destructive cloud mutations require explicit operator Ed25519 authorization.
        </p>
        <Link href="/" className="btn-secondary">
          Return to Overview
        </Link>
      </div>
    </div>
  );
}
