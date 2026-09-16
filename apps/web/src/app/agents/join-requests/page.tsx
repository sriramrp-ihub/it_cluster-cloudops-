"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  fetchJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  JoinRequestItem
} from "../../../lib/api";
import { useOperator } from "../../../auth/OperatorContext";

export default function JoinRequestsPage() {
  const { session } = useOperator();
  const [requests, setRequests] = useState<JoinRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED">("ALL");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  async function loadRequests() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const items = await fetchJoinRequests(tenantId, operatorId);
      setRequests(items);
    } catch (err: any) {
      setErrorMsg(`Failed to load join requests: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, [tenantId]);

  async function handleQuickApprove(id: string) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await approveJoinRequest(id, tenantId, operatorId);
      setSuccessMsg(`Agent join request approved. Sovereign identity minted: ${res.agentId}. Note: Agent is Approved, not yet connected.`);
      await loadRequests();
    } catch (err: any) {
      setErrorMsg(`Approval failed: ${err.message}`);
    }
  }

  async function handleQuickReject(id: string) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await rejectJoinRequest(id, tenantId, operatorId, "Operator rejection from queue");
      setSuccessMsg(`Join request ${id} rejected.`);
      await loadRequests();
    } catch (err: any) {
      setErrorMsg(`Rejection failed: ${err.message}`);
    }
  }

  const pendingCount = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
  const filteredRequests = requests.filter((r) => {
    if (filter === "ALL") return true;
    return r.status === filter;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Subnav Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", borderBottom: "1px solid var(--warm-gray-border)", paddingBottom: "12px" }}>
        <Link href="/agents" style={{ fontSize: "14px", color: "var(--mid-warm-gray)", textDecoration: "none", fontWeight: 500 }}>
          Fleet Directory
        </Link>
        <Link href="/agents/add" style={{ fontSize: "14px", color: "var(--mid-warm-gray)", textDecoration: "none", fontWeight: 500 }}>
          + Add Agent
        </Link>
        <span style={{ fontSize: "14px", color: "var(--near-black-ink)", fontWeight: 600, borderBottom: "2px solid var(--near-black-ink)", paddingBottom: "12px", marginBottom: "-13px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          Join Requests
          {pendingCount > 0 && (
            <span style={{ background: "#fef3c7", color: "#92400e", fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "10px" }}>
              {pendingCount}
            </span>
          )}
        </span>
        <Link href="/agents/diagnostics" style={{ fontSize: "14px", color: "var(--mid-warm-gray)", textDecoration: "none", fontWeight: 500 }}>
          Diagnostics
        </Link>
      </div>

      {/* Page Header */}
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
              Access Review Queue
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Agent Join Requests
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Review prospective agents requesting admission to operate infrastructure. Inspect declared capabilities before granting sovereign identity.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={loadRequests} disabled={loading} className="btn-secondary" style={{ fontSize: "13px" }}>
            {loading ? "Refreshing..." : "Refresh Queue"}
          </button>
          <Link href="/agents/add" className="btn-primary" style={{ fontSize: "13px" }}>
            + Onboard Agent
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          onClick={() => setFilter("ALL")}
          className={`btn-secondary ${filter === "ALL" ? "active" : ""}`}
          style={{
            fontSize: "13px",
            background: filter === "ALL" ? "var(--near-black-ink)" : "#ffffff",
            color: filter === "ALL" ? "#ffffff" : "var(--near-black-ink)"
          }}
        >
          All Requests ({requests.length})
        </button>
        <button
          onClick={() => setFilter("PENDING_APPROVAL")}
          className={`btn-secondary ${filter === "PENDING_APPROVAL" ? "active" : ""}`}
          style={{
            fontSize: "13px",
            background: filter === "PENDING_APPROVAL" ? "var(--near-black-ink)" : "#ffffff",
            color: filter === "PENDING_APPROVAL" ? "#ffffff" : "var(--near-black-ink)"
          }}
        >
          Pending Review ({pendingCount})
        </button>
        <button
          onClick={() => setFilter("APPROVED")}
          className={`btn-secondary ${filter === "APPROVED" ? "active" : ""}`}
          style={{
            fontSize: "13px",
            background: filter === "APPROVED" ? "var(--near-black-ink)" : "#ffffff",
            color: filter === "APPROVED" ? "#ffffff" : "var(--near-black-ink)"
          }}
        >
          Approved ({requests.filter((r) => r.status === "APPROVED").length})
        </button>
        <button
          onClick={() => setFilter("REJECTED")}
          className={`btn-secondary ${filter === "REJECTED" ? "active" : ""}`}
          style={{
            fontSize: "13px",
            background: filter === "REJECTED" ? "var(--near-black-ink)" : "#ffffff",
            color: filter === "REJECTED" ? "#ffffff" : "var(--near-black-ink)"
          }}
        >
          Rejected ({requests.filter((r) => r.status === "REJECTED").length})
        </button>
      </div>

      {/* Alerts */}
      {errorMsg && (
        <div className="alert-banner error">
          <div style={{ fontWeight: 600 }}>Error:</div>
          <div>{errorMsg}</div>
        </div>
      )}

      {successMsg && (
        <div className="alert-banner success">
          <div style={{ fontWeight: 600 }}>Success:</div>
          <div>{successMsg}</div>
        </div>
      )}

      {/* Review Queue Content */}
      {loading && requests.length === 0 ? (
        <div className="harvey-card" style={{ padding: "48px", textAlign: "center", color: "var(--mid-warm-gray)" }}>
          Loading join requests queue...
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="harvey-card" style={{ padding: "48px 24px", textAlign: "center", border: "1px dashed var(--warm-gray-border)" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#edece9", display: "inline-flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", color: "var(--mid-warm-gray)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
            No Join Requests Found
          </div>
          <p className="body-subtle" style={{ maxWidth: "460px", margin: "0 auto 20px" }}>
            {filter === "PENDING_APPROVAL"
              ? "All agent requests have been reviewed. There are no pending requests waiting for your approval."
              : "No agent join requests match the selected filter."}
          </p>
          <Link href="/agents/add" className="btn-secondary">
            + Generate Agent Invitation
          </Link>
        </div>
      ) : (
        <div className="harvey-card" style={{ padding: "0" }}>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent & Framework</th>
                  <th>Status</th>
                  <th>Requested Capabilities</th>
                  <th>Submission Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--near-black-ink)", fontSize: "14px" }}>
                        {req.agentName}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px" }}>
                        <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", background: "#f0efe9", padding: "1px 5px", borderRadius: "3px" }}>
                          {req.agentType}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
                          {req.id}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          req.status === "APPROVED"
                            ? "approved"
                            : req.status === "PENDING_APPROVAL"
                            ? "pending"
                            : "rejected"
                        }`}
                      >
                        <span className="status-dot-inner" />
                        {req.status === "PENDING_APPROVAL" ? "PENDING REVIEW" : req.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", maxWidth: "320px" }}>
                        {req.declaredCapabilities?.length ? (
                          req.declaredCapabilities.slice(0, 3).map((cap) => (
                            <span key={cap} className="code-inline" style={{ fontSize: "11px" }}>
                              {cap}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "var(--mid-warm-gray)", fontSize: "12px" }}>None specified</span>
                        )}
                        {req.declaredCapabilities && req.declaredCapabilities.length > 3 && (
                          <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", padding: "2px 4px" }}>
                            +{req.declaredCapabilities.length - 3} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--mid-warm-gray)", whiteSpace: "nowrap" }}>
                      {new Date(req.createdAt).toLocaleDateString()} {new Date(req.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td>
                      {req.status === "PENDING_APPROVAL" ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Link
                            href={`/agents/join-requests/${req.id}`}
                            className="btn-primary"
                            style={{ fontSize: "12px", padding: "4px 10px" }}
                          >
                            Review Request
                          </Link>
                          <button
                            onClick={() => handleQuickApprove(req.id)}
                            className="btn-secondary"
                            style={{ fontSize: "12px", padding: "4px 8px" }}
                            title="Approve"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                          </button>
                          <button
                            onClick={() => handleQuickReject(req.id)}
                            className="btn-secondary"
                            style={{ fontSize: "12px", padding: "4px 8px", color: "var(--status-danger-text)" }}
                            title="Reject"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        </div>
                      ) : req.status === "APPROVED" ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {req.agentId ? (
                            <Link href={`/agents/${req.agentId}`} className="btn-secondary" style={{ fontSize: "11px", padding: "3px 8px" }}>
                              View Dossier ({req.agentId.slice(0, 10)}...)
                            </Link>
                          ) : (
                            <span style={{ fontSize: "12px", color: "#16a34a" }}>Approved</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--status-danger-text)" }}>
                          Rejected
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Security Invariant Callout */}
      <div className="alert-banner info">
        <div style={{ display: "flex", alignItems: "center", color: "var(--near-black-ink)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div>
          <div style={{ fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "3px" }}>
            Operational Security Principle: Declared Capabilities ≠ Authorized Privileges
          </div>
          <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
            Agents declare the tools and capabilities they wish to operate during onboarding. Approving a join request grants sovereign identity and permits runtime connection, but operational policies govern what actions the agent may actually execute.
          </p>
        </div>
      </div>
    </div>
  );
}
