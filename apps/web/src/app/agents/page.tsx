"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { fetchAgents, deleteAgent, connectAgent, AgentItem } from "../../lib/api";
import { useOperator } from "../../auth/OperatorContext";
import { useAgentChat } from "../../context/AgentChatContext";
import { TestAgentModal } from "../../components/agents/TestAgentModal";

type StatusFilter = "ALL" | "CONNECTED" | "REGISTERED" | "DISCONNECTED";

export default function AgentsFleetPage() {
  const { session } = useOperator();
  const { setChatContext, openChat } = useAgentChat();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [agentToDelete, setAgentToDelete] = useState<AgentItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedTestAgent, setSelectedTestAgent] = useState<AgentItem | null>(null);
  const [connectingAgentId, setConnectingAgentId] = useState<string | null>(null);

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

  async function handleInlineConnect(agentId: string) {
    setConnectingAgentId(agentId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await connectAgent(agentId, true, tenantId, operatorId);
      setSuccessMsg(`Connector daemon spawned (PID ${res.connectorPid}) on ${res.mcpSseUrl}`);
      await loadAgents();
    } catch (err: any) {
      setErrorMsg(`Failed to connect agent: ${err.message}`);
    } finally {
      setConnectingAgentId(null);
    }
  }

  useEffect(() => {
    loadAgents();
    setChatContext({
      sourcePage: "Agents Fleet",
      environment: "Production"
    });
  }, [tenantId, setChatContext]);

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.id.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === "CONNECTED") return agent.status === "CONNECTED";
    if (statusFilter === "REGISTERED") return agent.status === "REGISTERED" || agent.status === "APPROVED";
    if (statusFilter === "DISCONNECTED") return agent.status !== "CONNECTED" && agent.status !== "REGISTERED" && agent.status !== "APPROVED";
    return true;
  });

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
          <Link href="/agents/new" className="btn-primary" style={{ fontSize: "13px" }}>
            + New Agent
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
            Connected &amp; Active ({connectedAgents.length})
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
                      Type: <strong style={{ color: "var(--dark-warm-gray)", textTransform: "capitalize" }}>{agent.type}</strong> • Protocol: <span className="code-inline" style={{ fontSize: "11px" }}>{agent.runtimeProtocol}</span>
                    </div>
                  </div>
                  <span className="status-pill connected" style={{ fontSize: "11px" }}>
                    <span className="status-dot-inner" />
                    CONNECTED
                  </span>
                </div>

                <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <Link href={`/agents/${agent.id}`} className="btn-secondary" style={{ padding: "6px 14px", fontSize: "13px" }}>
                    View Dossier
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedTestAgent(agent)}
                    style={{
                      padding: "6px 14px",
                      fontSize: "13px",
                      borderRadius: "4px",
                      border: "1px solid var(--warm-gray-border)",
                      backgroundColor: "#ffffff",
                      cursor: "pointer",
                      fontWeight: 500
                    }}
                  >
                    Test Agent
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Filter & Search Controls */}
      <div className="harvey-card" style={{ padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.25rem" }}>
          {/* Status Filter Tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {(["ALL", "CONNECTED", "REGISTERED", "DISCONNECTED"] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  borderRadius: "4px",
                  border: statusFilter === filter ? "1px solid var(--near-black-ink)" : "1px solid var(--border-subtle)",
                  backgroundColor: statusFilter === filter ? "var(--near-black-ink)" : "transparent",
                  color: statusFilter === filter ? "#ffffff" : "var(--mid-warm-gray)",
                  cursor: "pointer",
                  fontWeight: statusFilter === filter ? 600 : 500,
                  textTransform: "capitalize"
                }}
              >
                {filter.toLowerCase()}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <input
            type="text"
            placeholder="Search agents by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: "4px",
              border: "1px solid var(--warm-gray-border)",
              fontSize: "13px",
              minWidth: "240px",
              backgroundColor: "var(--pure-white)"
            }}
          />
        </div>

        {/* Data Table */}
        {loading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--mid-warm-gray)" }}>
            Loading agents fleet...
          </div>
        ) : filteredAgents.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--mid-warm-gray)" }}>
            <p style={{ marginBottom: "1rem" }}>No agents found matching &quot;{statusFilter.toLowerCase()}&quot; filter.</p>
            <Link href="/agents/new" className="btn-primary" style={{ display: "inline-block", fontSize: "13px" }}>
              + Provision New Agent
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
                {filteredAgents.map((agent) => {
                  const isConnected = agent.status === "CONNECTED";
                  const isConnecting = connectingAgentId === agent.id;

                  return (
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
                            borderRadius: "var(--radius-sm)",
                            textTransform: "uppercase"
                          }}
                        >
                          {agent.type} (v{agent.version})
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            isConnected
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
                          {!isConnected && (
                            <button
                              type="button"
                              onClick={() => handleInlineConnect(agent.id)}
                              disabled={isConnecting}
                              style={{
                                padding: "4px 10px",
                                fontSize: "12px",
                                borderRadius: "4px",
                                border: "1px solid var(--near-black-ink)",
                                backgroundColor: "var(--near-black-ink)",
                                color: "#ffffff",
                                cursor: isConnecting ? "not-allowed" : "pointer",
                                fontWeight: 500
                              }}
                            >
                              {isConnecting ? "Spawning..." : "Connect"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedTestAgent(agent)}
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              borderRadius: "4px",
                              border: "1px solid var(--warm-gray-border)",
                              backgroundColor: "#ffffff",
                              color: "var(--dark-warm-gray)",
                              cursor: "pointer",
                              fontWeight: 500
                            }}
                          >
                            Test
                          </button>

                          <Link
                            href={`/agents/${agent.id}`}
                            className="btn-secondary"
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            Dossier
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
                  );
                })}
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
              backgroundColor: "#ffffff"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "8px" }}>
              Delete Agent &apos;{agentToDelete.name}&apos;?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: "1.5", marginBottom: "20px" }}>
              This action terminates running connector sidecars, revokes cryptographic credentials, and cleans up audit references.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
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
                style={{ fontSize: "13px" }}
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Test Agent Modal */}
      {selectedTestAgent && (
        <TestAgentModal
          agentId={selectedTestAgent.id}
          agentName={selectedTestAgent.name}
          isOpen={Boolean(selectedTestAgent)}
          onClose={() => setSelectedTestAgent(null)}
        />
      )}
    </div>
  );
}
