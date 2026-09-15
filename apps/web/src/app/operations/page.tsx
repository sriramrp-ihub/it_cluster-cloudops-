import React from "react";
import Link from "next/link";

export default function OperationsPage() {
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
            Phase 6 Execution Engine
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
            ARCHITECTURAL CONTRACT
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Cloud Operations & Runs
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Catalog of autonomous cloud execution runs, granular tool invocations, and multi-turn operational traces.
        </p>
      </div>

      {/* Contract & Schema Card */}
      <div className="harvey-card" style={{ borderLeft: "4px solid var(--near-black-ink)" }}>
        <h3 className="panel-title" style={{ marginBottom: "8px" }}>
          Phase 6 Architectural Contract: Tool Gateway Execution
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          CloudOps strictly separates agent reasoning from execution authority. Agents propose operations; the Tool Gateway enforces capabilities, executes within credential-isolated sandbox boundaries, and records multi-turn traces.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Provisioned Schema: runs
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Tracks conversational execution sessions (<code className="code-inline">run_&lt;uuid&gt;</code>), user prompts, initiating agents, and completion timestamps.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Provisioned Schema: tool_executions
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Granular per-tool records capturing invocation inputs, output payloads, execution duration, and error codes.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Provisioned Schema: cloud_accounts
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Multi-cloud identity bindings (AWS Role ARN, GCP Workload Identity, Azure Managed Identity).
            </p>
          </div>
        </div>
      </div>

      {/* Honest Empty State */}
      <div className="harvey-card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--near-black-ink)", marginBottom: "8px" }}>
          Execution Engine Awaiting Phase 6 Activation
        </div>
        <p className="body-subtle" style={{ maxWidth: "540px", margin: "0 auto 20px auto" }}>
          Current milestone is Phase 3 (Runtime Gateway & Agent Registration). Operational execution endpoints (<code className="code-inline">POST /v1/runs</code>) will be wired when the Tool Gateway execution runtime lands.
        </p>
        <Link href="/" className="btn-secondary">
          ← Return to Operational Overview
        </Link>
      </div>
    </div>
  );
}
