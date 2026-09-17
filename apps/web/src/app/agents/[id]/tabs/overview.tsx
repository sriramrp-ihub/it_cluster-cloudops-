"use client";

import React from "react";
import { AgentItem } from "../../../../lib/api";

interface OverviewTabProps {
  agent: AgentItem;
  mcpSseUrl?: string;
  uptimeHours?: number;
  lastHeartbeat?: string;
  capabilitiesCount?: number;
  skillsCount?: number;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  agent,
  mcpSseUrl,
  uptimeHours = 12.4,
  lastHeartbeat = "Just now (within 5s)",
  capabilitiesCount = 8,
  skillsCount = 3
}) => {
  const cardStyle: React.CSSProperties = {
    padding: "1.25rem",
    backgroundColor: "var(--pure-white)",
    borderRadius: "8px",
    border: "1px solid var(--border-subtle)",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    boxShadow: "0 1px 3px rgba(15, 14, 13, 0.02)"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Metric Cards Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        <div style={cardStyle}>
          <span style={{ fontSize: "11px", color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Operational Status
          </span>
          <strong style={{ fontSize: "18px", color: "var(--near-black-ink)" }}>
            {agent.status}
          </strong>
          <span style={{ fontSize: "12px", color: agent.status === "CONNECTED" ? "#16a34a" : "var(--mid-warm-gray)" }}>
            {agent.status === "CONNECTED" ? "• Active Gateway Session" : "• Standby"}
          </span>
        </div>

        <div style={cardStyle}>
          <span style={{ fontSize: "11px", color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Heartbeat Cadence
          </span>
          <strong style={{ fontSize: "18px", color: "var(--near-black-ink)" }}>
            {lastHeartbeat}
          </strong>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
            Interval: 30s • Timeout: 90s
          </span>
        </div>

        <div style={cardStyle}>
          <span style={{ fontSize: "11px", color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Authorized Capabilities
          </span>
          <strong style={{ fontSize: "18px", color: "var(--near-black-ink)" }}>
            {capabilitiesCount} Tools
          </strong>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
            Governed via DefenseClaw Rego
          </span>
        </div>

        <div style={cardStyle}>
          <span style={{ fontSize: "11px", color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Active Skills
          </span>
          <strong style={{ fontSize: "18px", color: "var(--near-black-ink)" }}>
            {skillsCount} Workflows
          </strong>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
            Autonomous Incident Diagnostics
          </span>
        </div>
      </div>

      {/* Connection & Runtime Spec */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "var(--pure-white)",
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem"
        }}
      >
        <h4 style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)" }}>
          Connection &amp; Runtime Overview
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", fontSize: "13px" }}>
          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Runtime Protocol</span>
            <strong style={{ color: "var(--dark-warm-gray)", fontFamily: "var(--font-mono)" }}>
              {agent.runtimeProtocol.toUpperCase()} (Agent Communication Protocol)
            </strong>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Tenant Isolation ID</span>
            <strong style={{ color: "var(--dark-warm-gray)", fontFamily: "var(--font-mono)" }}>
              {agent.tenantId}
            </strong>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Created Timestamp</span>
            <span style={{ color: "var(--dark-warm-gray)", fontFamily: "var(--font-mono)" }}>
              {new Date(agent.createdAt).toLocaleString()}
            </span>
          </div>

          <div>
            <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>Last Synchronized</span>
            <span style={{ color: "var(--dark-warm-gray)", fontFamily: "var(--font-mono)" }}>
              {new Date(agent.updatedAt).toLocaleString()}
            </span>
          </div>

          {mcpSseUrl && (
            <div style={{ gridColumn: "1 / -1" }}>
              <span style={{ color: "var(--muted-gray)", display: "block", marginBottom: "2px" }}>MCP SSE Endpoint</span>
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "4px",
                  backgroundColor: "#fafaf9",
                  border: "1px solid var(--border-subtle)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "#0369a1"
                }}
              >
                {mcpSseUrl}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
