"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { fetchAgents, AgentItem } from "../../lib/api";
import { useOperator } from "../../auth/OperatorContext";
import { useAgentChat } from "../../context/AgentChatContext";

export default function AgentsFleetPage() {
  const { session } = useOperator();
  const { setChatContext, openChat } = useAgentChat();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  async function loadAgents() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await fetchAgents(tenantId, operatorId);
      setAgents(data);
    } catch (err: any) {
      setErrorMsg(`Failed to load agents: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
    setChatContext({
      sourcePage: "Agents Fleet",
      environment: "Production"
    });
  }, [tenantId, setChatContext]);

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const connectedAgents = agents.filter((a) => a.status === "CONNECTED");

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
              Autonomous Agents
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Operational Agents
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Manage autonomous SRE and operations agents authorized to inspect and operate your infrastructure.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Link href="/agents/join-requests" className="btn-secondary" style={{ fontSize: "13px" }}>
            Join Requests Queue →
          </Link>
          <Link href="/agents/add" className="btn-primary" style={{ fontSize: "13px" }}>
            + Add Agent
          </Link>
        </div>
      </div>

      {/* 2. Error Message */}
      {errorMsg && (
        <div className="alert-banner error">
          <div>{errorMsg}</div>
        </div>
      )}

      {/* 3. Connected Agents Highlight Cards */}
      {connectedAgents.length > 0 && (
        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
            Connected & Active ({connectedAgents.length})
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem" }}>
            {connectedAgents.map((agent) => (
              <div key={agent.id} className="harvey-card" style={{ padding: "20px 24px", borderTop: "3px solid var(--near-black-ink)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#22c55e" }} />
                      <h3 style={{ fontSize: "17px", fontWeight: 600, color: "var(--near-black-ink)", margin: 0 }}>
                        {agent.name}
                      </h3>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>
                      {agent.type} autonomous daemon · v{agent.version}
                    </div>
                  </div>

                  <span className="status-pill connected" style={{ fontSize: "10.5px" }}>
                    CONNECTED
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)", fontSize: "12.5px", marginBottom: "14px" }}>
                  <span style={{ color: "var(--mid-warm-gray)" }}>Protocol:</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{agent.runtimeProtocol.toUpperCase()} (WebSocket)</span>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <Link
                    href={`/agents/${agent.id}`}
                    className="btn-primary"
                    style={{ flex: 1, fontSize: "12.5px", justifyContent: "center" }}
                  >
                    View Agent Dossier →
                  </Link>
                  <button
                    type="button"
                    onClick={() => openChat(`Ask ${agent.name} to run an infrastructure health check`)}
                    className="btn-secondary"
                    style={{ fontSize: "12.5px" }}
                  >
                    Inquire
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Full Fleet Directory */}
      <div className="harvey-card" style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
              All Registered Agents ({agents.length})
            </h2>
            <p className="body-subtle" style={{ margin: "2px 0 0 0", fontSize: "13px" }}>
              Complete fleet inventory across active and standby runtimes.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="text"
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input"
              style={{ width: "220px", fontSize: "13px", padding: "6px 10px" }}
            />
            <button
              onClick={loadAgents}
              disabled={loading}
              className="btn-secondary"
              style={{ fontSize: "13px", padding: "6px 12px" }}
            >
              {loading ? "..." : "↻ Refresh"}
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#edece9", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginBottom: "12px" }}>
              🤖
            </div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", color: "var(--near-black-ink)", marginBottom: "6px" }}>
              No agents connected yet.
            </div>
            <p className="body-subtle" style={{ maxWidth: "440px", margin: "0 auto 20px auto" }}>
              Connect an autonomous CloudOps agent (e.g. Hermes SRE or OpenClaw) to begin automated monitoring and incident diagnosis.
            </p>
            <Link href="/agents/add" className="btn-primary">
              + Add Agent
            </Link>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Framework</th>
                  <th>Status</th>
                  <th>Registered On</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <Link href={`/agents/${agent.id}`} style={{ fontWeight: 600, color: "var(--near-black-ink)" }}>
                        {agent.name}
                      </Link>
                      <div className="code-inline" style={{ fontSize: "11px", marginTop: "2px" }}>
                        {agent.id}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          background: "#edece9",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)"
                        }}
                      >
                        {agent.type} (v{agent.version})
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          agent.status === "CONNECTED"
                            ? "connected"
                            : agent.status === "REGISTERED"
                            ? "registered"
                            : "approved"
                        }`}
                      >
                        <span className="status-dot-inner" />
                        {agent.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/agents/${agent.id}`}
                        className="btn-secondary"
                        style={{ padding: "4px 10px", fontSize: "12px" }}
                      >
                        View Dossier →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
