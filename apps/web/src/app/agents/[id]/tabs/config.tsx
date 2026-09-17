"use client";

import React from "react";
import { AgentItem, CapabilityItem } from "../../../../lib/api";

interface ConfigTabProps {
  agent: AgentItem;
  capabilities: CapabilityItem[];
}

export const ConfigTab: React.FC<ConfigTabProps> = ({ agent, capabilities }) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Adapter Configuration */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "var(--pure-white)",
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)"
        }}
      >
        <h4 style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "1rem" }}>
          Adapter Configuration (Read-Only)
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem", fontSize: "13px" }}>
          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Agent Adapter Type</span>
            <strong style={{ color: "var(--near-black-ink)", textTransform: "capitalize" }}>{agent.type}</strong>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Runtime Version</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>v{agent.version}</span>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Gateway URL</span>
            <span style={{ fontFamily: "var(--font-mono)" }}>http://host.docker.internal:8642</span>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Session Key Strategy</span>
            <span>Scoped (Per-Run Isolation)</span>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Execution Timeout</span>
            <span>1,800 seconds (30m)</span>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Event Reconnect Interval</span>
            <span>2,000 ms</span>
          </div>
        </div>
      </div>

      {/* Authorized Capabilities */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "var(--pure-white)",
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)" }}>
            Authorized Capabilities ({capabilities.length})
          </h4>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
            Governed by DefenseClaw OPA Fences
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {capabilities.map((cap) => (
            <div
              key={cap.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: "4px",
                backgroundColor: "#fafaf9",
                border: "1px solid #f2f1ef"
              }}
            >
              <div>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--near-black-ink)", marginRight: "8px" }}>
                  {cap.name}
                </span>
                <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--muted-gray)" }}>
                  {cap.id}
                </span>
              </div>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  backgroundColor: cap.tier === "read" ? "#ecfdf5" : cap.tier === "mutate" ? "#fef3c7" : "#fee2e2",
                  color: cap.tier === "read" ? "#065f46" : cap.tier === "mutate" ? "#92400e" : "#991b1b"
                }}
              >
                {cap.tier}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
