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
            Execution History
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Cloud Operations & Runs
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Audit log of cloud operations, tool invocations, and autonomous agent executions.
        </p>
      </div>

      {/* Execution Architecture Note: Agents propose operations; the Tool Gateway enforces capabilities, executes within credential-isolated sandbox boundaries, and records multi-turn traces. */}
      <div className="harvey-card" style={{ borderLeft: "4px solid var(--near-black-ink)" }}>
        <h3 className="panel-title" style={{ marginBottom: "8px" }}>
          Tool Gateway Execution Architecture
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          CloudOps strictly separates agent reasoning from execution authority. Agents propose operations; the Tool Gateway enforces capabilities, executes within credential-isolated sandbox boundaries, and records multi-turn traces.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Execution Runs
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Tracks conversational execution sessions, operator prompts, initiating agents, and completion status.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Tool Invocations
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Granular per-tool records capturing invocation inputs, output payloads, execution duration, and error codes.
            </p>
          </div>

          <div style={{ padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
              Cloud Provider Bindings
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
              Multi-cloud identity bindings (AWS Role ARN, GCP Workload Identity, Azure Managed Identity).
            </p>
          </div>
        </div>
      </div>

      {/* Empty State */}
      <div className="harvey-card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--near-black-ink)", marginBottom: "8px" }}>
          No Operational Runs Recorded
        </div>
        <p className="body-subtle" style={{ maxWidth: "540px", margin: "0 auto 20px auto" }}>
          Operational execution logs and agent tool traces will automatically populate here as tasks are executed across connected workloads.
        </p>
        <Link href="/" className="btn-secondary">
          Return to Overview
        </Link>
      </div>
    </div>
  );
}
