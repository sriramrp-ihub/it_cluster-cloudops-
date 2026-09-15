"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { fetchAgent, AgentItem } from "../../../lib/api";
import { useOperator } from "../../../auth/OperatorContext";
import { useAgentChat } from "../../../context/AgentChatContext";

export default function AgentDossierPage({ params }: { params: Promise<{ agentId: string }> }) {
  const resolvedParams = use(params);
  const agentId = resolvedParams.agentId;

  const { session } = useOperator();
  const { setChatContext, openChat } = useAgentChat();
  const [agent, setAgent] = useState<AgentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "capabilities" | "activity" | "runs" | "diagnostics">("overview");

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  async function loadAgentData() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await fetchAgent(agentId, tenantId, operatorId);
      setAgent(data);
    } catch (err: any) {
      setErrorMsg(`Failed to load agent dossier: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgentData();
  }, [agentId, tenantId]);

  useEffect(() => {
    if (agent) {
      setChatContext({
        agentId: agent.id,
        sourcePage: `Agent: ${agent.name}`
      });
    }
  }, [agent, setChatContext]);

  function copyId() {
    navigator.clipboard.writeText(agentId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div style={{ padding: "64px", textAlign: "center", color: "var(--mid-warm-gray)", fontFamily: "var(--font-mono)" }}>
        Loading agent dossier for {agentId}...
      </div>
    );
  }

  if (errorMsg || !agent) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div className="alert-banner error">
          <div style={{ fontWeight: 600 }}>Error:</div>
          <div>{errorMsg || "Agent not found"}</div>
        </div>
        <Link href="/agents" className="btn-secondary" style={{ width: "fit-content" }}>
          ← Return to Fleet Directory
        </Link>
      </div>
    );
  }

  const isConnected = agent.status === "CONNECTED";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Breadcrumb & Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--mid-warm-gray)" }}>
          <Link href="/agents" style={{ textDecoration: "underline" }}>
            Fleet Directory
          </Link>
          <span>/</span>
          <span style={{ color: "var(--near-black-ink)", fontWeight: 500 }}>{agent.name}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={loadAgentData} className="btn-secondary" style={{ fontSize: "13px" }}>
            ↻ Refresh
          </button>
          <button
            onClick={() => openChat(`Ask ${agent.name} to report operational status`)}
            className="btn-primary"
            style={{ fontSize: "13px" }}
          >
            Inquire with Agent →
          </button>
        </div>
      </div>

      {/* 2. Hero Dossier Card */}
      <div className="harvey-card" style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1.5rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "32px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                {agent.name}
              </h1>
              <span
                className={`status-pill ${
                  isConnected ? "connected" : agent.status === "REGISTERED" ? "registered" : "approved"
                }`}
              >
                <span className="status-dot-inner" />
                {agent.status}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "13px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>ID:</span>
                <span className="code-inline">{agent.id}</span>
                <button
                  onClick={copyId}
                  className="btn-secondary"
                  style={{ padding: "2px 6px", fontSize: "11px" }}
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <span style={{ color: "var(--warm-gray-border)" }}>•</span>
              <div>
                <span style={{ color: "var(--mid-warm-gray)" }}>Framework:</span>{" "}
                <span style={{ fontWeight: 500 }}>{agent.type} (v{agent.version})</span>
              </div>
              <span style={{ color: "var(--warm-gray-border)" }}>•</span>
              <div>
                <span style={{ color: "var(--mid-warm-gray)" }}>Protocol:</span>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{agent.runtimeProtocol.toUpperCase()}</span>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "10px 18px",
              background: isConnected ? "var(--near-black-ink)" : "#f7f6f4",
              color: isConnected ? "#ffffff" : "var(--near-black-ink)",
              border: "1px solid var(--warm-gray-border)",
              borderRadius: "var(--radius-sm)",
              textAlign: "right"
            }}
          >
            <div style={{ fontSize: "10.5px", textTransform: "uppercase", letterSpacing: "0.5px", color: isConnected ? "#a8a29e" : "var(--mid-warm-gray)" }}>
              Fleet State
            </div>
            <div style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
              {isConnected ? "ACTIVE • CONNECTED" : "OFFLINE • STANDBY"}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Tab Navigation */}
      <div className="tab-navigation-bar">
        {(["overview", "capabilities", "activity", "runs", "diagnostics"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setActiveTab(tabKey)}
            className={`tab-nav-btn ${activeTab === tabKey ? "active" : ""}`}
            style={{ textTransform: "capitalize" }}
          >
            {tabKey}
          </button>
        ))}
      </div>

      {/* 4. Tab Contents */}

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
          <div className="harvey-card" style={{ padding: "20px 24px" }}>
            <h3 className="panel-title" style={{ marginBottom: "8px" }}>Operational Assignment</h3>
            <p className="body-subtle" style={{ marginBottom: "14px", fontSize: "13px" }}>
              Operational parameters and tenant configuration.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Assigned Tenant:</span>
                <span className="code-inline">{tenantId}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Registration:</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                  {new Date(agent.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Autonomous Scope:</span>
                <span>Telemetry Inspection & Bounded Actions</span>
              </div>
            </div>
          </div>

          <div className="harvey-card" style={{ padding: "20px 24px" }}>
            <h3 className="panel-title" style={{ marginBottom: "8px" }}>Current Workload</h3>
            <p className="body-subtle" style={{ marginBottom: "14px", fontSize: "13px" }}>
              Real-time operational dispatch state.
            </p>

            <div style={{ padding: "12px 14px", background: "#fcfbf9", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", fontSize: "13.5px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                Status
              </div>
              <div style={{ fontWeight: 500, marginTop: "4px" }}>
                {isConnected ? "Standby — Ready to receive operational investigation tasks" : "Offline — Daemon process not connected to Gateway WebSocket"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Capabilities */}
      {activeTab === "capabilities" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h3 className="panel-title">Authorized Operational Capabilities</h3>
              <p className="body-subtle" style={{ margin: "2px 0 0 0", fontSize: "13px" }}>
                Cryptographic policy boundaries governing what this agent is allowed to execute.
              </p>
            </div>
            <span className="status-pill approved">GOVERNED</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
            <div style={{ padding: "14px", background: "#fcfbf9", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--near-black-ink)", textTransform: "uppercase", marginBottom: "6px" }}>
                AWS ECS Inspection
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="code-inline" style={{ fontSize: "11px" }}>aws.ecs.describe_clusters</span>
                <span className="code-inline" style={{ fontSize: "11px" }}>aws.ecs.list_tasks</span>
              </div>
            </div>

            <div style={{ padding: "14px", background: "#fcfbf9", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--near-black-ink)", textTransform: "uppercase", marginBottom: "6px" }}>
                CloudWatch Telemetry
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span className="code-inline" style={{ fontSize: "11px" }}>aws.cloudwatch.get_metric_data</span>
                <span className="code-inline" style={{ fontSize: "11px" }}>aws.logs.filter_log_events</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Activity */}
      {activeTab === "activity" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <h3 className="panel-title" style={{ marginBottom: "12px" }}>Operational Lifecycle Timeline</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#16a34a" }}>●</span>
              <span style={{ fontWeight: 500 }}>Identity Created:</span>
              <span style={{ color: "var(--mid-warm-gray)" }}>Sovereign identity minted</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: isConnected ? "#16a34a" : "#f59e0b" }}>●</span>
              <span style={{ fontWeight: 500 }}>Gateway Session:</span>
              <span style={{ color: "var(--mid-warm-gray)" }}>
                {isConnected ? "Authenticated WebSocket established" : "Registered in fleet database"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Runs */}
      {activeTab === "runs" && (
        <div className="harvey-card" style={{ padding: "24px", textAlign: "center" }}>
          <p style={{ fontSize: "14px", color: "var(--near-black-ink)", fontWeight: 500 }}>
            No Dispatched Runs Active
          </p>
          <p className="body-subtle" style={{ maxWidth: "420px", margin: "4px auto 16px auto", fontSize: "12.5px" }}>
            Autonomous investigation runs and tool execution traces will appear here when this agent executes an inquiry.
          </p>
          <button
            type="button"
            onClick={() => openChat(`Ask ${agent.name} to investigate current cluster health`)}
            className="btn-secondary"
            style={{ fontSize: "12.5px" }}
          >
            Launch Investigation with Agent →
          </button>
        </div>
      )}

      {/* Tab: Diagnostics (Hidden behind progressive disclosure tab) */}
      {activeTab === "diagnostics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="harvey-card" style={{ padding: "20px 24px" }}>
            <h3 className="panel-title" style={{ marginBottom: "8px" }}>Gateway Diagnostics & Protocol Frames</h3>
            <p className="body-subtle" style={{ fontSize: "13px", marginBottom: "16px" }}>
              Low-level WebSocket transport frames, heartbeat telemetry, and session state.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12.5px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Gateway Route:</span>
                <span className="code-inline">/gateway/v1/ws</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Heartbeat Interval:</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>10,000 ms</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Heartbeat Timeout:</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>30,000 ms</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ color: "var(--mid-warm-gray)" }}>Protocol Handshake:</span>
                <span style={{ color: "#16a34a", fontWeight: 500 }}>AUTH → AUTH_ACK (Nonce Exchanged)</span>
              </div>
            </div>
          </div>

          <div className="harvey-card" style={{ padding: "20px 24px" }}>
            <h3 className="panel-title" style={{ marginBottom: "12px" }}>Raw WebSocket Protocol Trace</h3>
            <pre
              style={{
                background: "#0f0e0d",
                color: "#f5f5f4",
                padding: "16px",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                lineHeight: 1.6,
                overflowX: "auto"
              }}
            >
              {`[WS_IN]  {"type":"AUTH","agentId":"${agent.id}","timestamp":"${agent.createdAt}"}
[WS_OUT] {"type":"AUTH_ACK","sessionId":"sess_7b92f...","status":"AUTHENTICATED"}
[WS_IN]  {"type":"HEARTBEAT","sequence":1}
[WS_OUT] {"type":"HEARTBEAT_ACK","sequence":1}`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
