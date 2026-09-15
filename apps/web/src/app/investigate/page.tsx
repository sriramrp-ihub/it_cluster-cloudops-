"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";

export default function InvestigatePage() {
  const { setChatContext, openChat } = useAgentChat();
  const [selectedIncident, setSelectedIncident] = useState<string | null>("checkout");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setChatContext({
      investigationId: selectedIncident || undefined,
      service: selectedIncident || undefined,
      sourcePage: "Investigations"
    });
  }, [selectedIncident, setChatContext]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
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
              Root Cause Diagnostics
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Investigations Workspace
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Autonomous incident diagnosis, evidence correlation, and operational root-cause analysis.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openChat("Investigate checkout")}
          className="btn-primary"
          style={{ fontSize: "13px" }}
        >
          + Launch Agent Investigation
        </button>
      </div>

      {/* 2. Investigation Toolbar */}
      <div className="harvey-card" style={{ padding: "14px 20px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search investigations by service, incident ID, or error message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input"
            style={{ flex: 1, fontSize: "13.5px" }}
          />
          <button
            type="button"
            onClick={() => openChat(searchQuery ? `Investigate ${searchQuery}` : "What services are unhealthy?")}
            className="btn-secondary"
            style={{ fontSize: "13px" }}
          >
            Investigate with Agent →
          </button>
        </div>
      </div>

      {/* 3. Active Investigations & Detail View */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
        {/* Active Investigations List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)" }}>
            Active Investigations
          </div>

          <div
            onClick={() => setSelectedIncident("checkout")}
            className="harvey-card"
            style={{
              padding: "20px 22px",
              cursor: "pointer",
              borderLeft: selectedIncident === "checkout" ? "3px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
              backgroundColor: selectedIncident === "checkout" ? "#faf9f7" : "#ffffff"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--near-black-ink)" }}>
                checkout
              </div>
              <span className="status-pill pending" style={{ fontSize: "10.5px" }}>
                INVESTIGATING
              </span>
            </div>

            <div style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", display: "flex", flexDirection: "column", gap: "3px" }}>
              <div>Agent: <strong>Hermes SRE</strong></div>
              <div>Started: 4 minutes ago</div>
            </div>
          </div>
        </div>

        {/* Selected Investigation Operational Workspace */}
        <div className="harvey-card" style={{ padding: "24px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                  checkout
                </h2>
                <span className="status-pill pending">INVESTIGATING</span>
              </div>
              <p className="body-subtle" style={{ fontSize: "13px", margin: 0 }}>
                Objective: Determine why checkout service container tasks are failing health checks.
              </p>
            </div>

            <button
              type="button"
              onClick={() => openChat("Ask Hermes SRE for the latest finding on checkout")}
              className="btn-secondary"
              style={{ fontSize: "12px" }}
            >
              Ask Agent ↗
            </button>
          </div>

          {/* Operational Progress / Activity Steps */}
          <div style={{ margin: "16px 0" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase", marginBottom: "8px" }}>
              Agent Operational Activity
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#16a34a" }}>
                <span>✓</span>
                <span>Checked ECS service definitions & replica health</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#16a34a" }}>
                <span>✓</span>
                <span>Checked running tasks & container exit status</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#16a34a" }}>
                <span>✓</span>
                <span>Checked ALB target group health probes</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--near-black-ink)", fontWeight: 500 }}>
                <span>→</span>
                <span>Inspecting CloudWatch RDS connection error traces</span>
              </div>
            </div>
          </div>

          {/* Correlated Evidence */}
          <div style={{ margin: "18px 0" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase", marginBottom: "8px" }}>
              Correlated Telemetry Evidence
            </div>
            <ul style={{ paddingLeft: "20px", fontSize: "12.5px", color: "var(--mid-warm-gray)", display: "flex", flexDirection: "column", gap: "4px" }}>
              <li>2 unhealthy tasks in Availability Zone us-east-1b</li>
              <li>Spike in connection timeout exceptions in container stderr logs</li>
              <li>RDS PostgreSQL active connections saturated at maximum threshold</li>
            </ul>
          </div>

          {/* Finding */}
          <div style={{ padding: "14px 16px", background: "#fcfbf9", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--near-black-ink)", textTransform: "uppercase", marginBottom: "4px" }}>
              Preliminary Finding (87% Confidence)
            </div>
            <p style={{ fontSize: "13px", color: "var(--near-black-ink)", margin: 0 }}>
              Likely database connectivity issue due to unpooled connections during traffic surge. Tasks are failing health checks because database queries exceed the 5000ms probe timeout.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={() => openChat("Scale checkout service to mitigate traffic spike")}
              className="btn-primary"
              style={{ fontSize: "12.5px" }}
            >
              Propose Remediation →
            </button>
            <Link href="/infrastructure/checkout" className="btn-secondary" style={{ fontSize: "12.5px" }}>
              View Checkout Workload
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
