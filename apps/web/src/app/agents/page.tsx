"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { fetchAgents, deleteAgent, AgentItem } from "../../lib/api";
import { useOperator } from "../../auth/OperatorContext";
import { useAgentChat } from "../../context/AgentChatContext";

export default function AgentsFleetPage() {
  const { session } = useOperator();
  const { setChatContext, openChat } = useAgentChat();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [agentToDelete, setAgentToDelete] = useState<AgentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  async function handleConfirmDelete() {
    if (!agentToDelete) return;
    setIsDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await deleteAgent(agentToDelete.id, tenantId, operatorId);
      setSuccessMsg(res.message || `Agent '${agentToDelete.name}' was successfully deleted.`);
      setAgentToDelete(null);
      await loadAgents();
    } catch (err: any) {
      setErrorMsg(`Failed to delete agent: ${err.message}`);
    } finally {
      setIsDeleting(false);
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
            Join Requests Queue
          </Link>
          <Link href="/agents/add" className="btn-primary" style={{ fontSize: "13px" }}>
            + Add Agent
          </Link>
        </div>
      </div>

      {/* 2. Feedback Messages */}
      {errorMsg && (
        <div className="alert-banner error">
          <div>{errorMsg}</div>
        </div>
      )}
      {successMsg && (
        <div className="alert-banner" style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            <span>{successMsg}</span>
          </div>
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
                    View Agent Dossier
                  </Link>
                  <button
                    type="button"
                    onClick={() => openChat(`Ask ${agent.name} to run an infrastructure health check`)}
                    className="btn-secondary"
                    style={{ fontSize: "12.5px" }}
                  >
                    Inquire
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentToDelete(agent)}
                    className="btn-danger"
                    style={{ fontSize: "12.5px" }}
                    title="Remove and decommission agent"
                  >
                    Delete
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
              {loading ? "..." : "Refresh"}
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#edece9", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "12px", color: "var(--mid-warm-gray)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" />
                <line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" />
                <line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" />
                <line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" />
                <line x1="1" y1="14" x2="4" y2="14" />
              </svg>
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
                      <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <Link
                          href={`/agents/${agent.id}`}
                          className="btn-secondary"
                          style={{ padding: "4px 10px", fontSize: "12px" }}
                        >
                          View Dossier
                        </Link>
                        <button
                          type="button"
                          onClick={() => setAgentToDelete(agent)}
                          className="btn-danger"
                          style={{ padding: "4px 8px", fontSize: "12px" }}
                          title="Delete Agent"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Delete Agent Confirmation Modal */}
      {agentToDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem"
          }}
          onClick={() => !isDeleting && setAgentToDelete(null)}
        >
          <div
            className="harvey-card"
            style={{
              maxWidth: "480px",
              width: "100%",
              padding: "24px 28px",
              backgroundColor: "#ffffff",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "20px", margin: 0, color: "var(--near-black-ink)" }}>
                Delete Operational Agent?
              </h3>
            </div>

            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "var(--radius-sm)",
                padding: "12px 14px",
                fontSize: "13px",
                color: "#991b1b",
                marginBottom: "16px",
                lineHeight: 1.5
              }}
            >
              You are about to permanently delete <strong>{agentToDelete.name}</strong> (<code>{agentToDelete.id}</code>).
            </div>

            <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)", marginBottom: "20px", lineHeight: 1.6 }}>
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                <li>All active sessions and bootstrap credentials will be revoked immediately.</li>
                <li>The agent runtime will be disconnected from the Gateway WebSocket transport.</li>
                <li>Incident investigation records will be unlinked (audit events remain cryptographically chained).</li>
                <li>This action <strong>cannot be undone</strong>.</li>
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setAgentToDelete(null)}
                disabled={isDeleting}
                className="btn-secondary"
                style={{ fontSize: "13px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="btn-danger"
                style={{ fontSize: "13px", padding: "6px 16px" }}
              >
                {isDeleting ? "Deleting Agent..." : "Confirm & Delete Agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
