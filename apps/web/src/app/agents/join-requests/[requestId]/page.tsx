"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJoinRequests, approveJoinRequest, rejectJoinRequest, JoinRequestItem } from "../../../../lib/api";
import { useOperator } from "../../../../auth/OperatorContext";

export default function AgentJoinRequestReviewPage({ params }: { params: Promise<{ requestId: string }> }) {
  const resolvedParams = use(params);
  const requestId = resolvedParams.requestId;

  const { session } = useOperator();
  const router = useRouter();
  const [request, setRequest] = useState<JoinRequestItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  async function loadRequest() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const items = await fetchJoinRequests(tenantId, operatorId);
      const found = items.find((r) => r.id === requestId);
      if (!found) {
        throw new Error(`Join request ${requestId} not found for current tenant.`);
      }
      setRequest(found);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequest();
  }, [requestId, tenantId]);

  async function handleApprove() {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await approveJoinRequest(requestId, tenantId, operatorId);
      setSuccessMsg(`Agent join request approved. Sovereign identity minted: ${res.agentId}.`);
      await loadRequest();
    } catch (err: any) {
      setErrorMsg(`Failed to approve request: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setErrorMsg("Please specify a reason for rejecting this join request.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await rejectJoinRequest(requestId, tenantId, operatorId, rejectReason);
      setSuccessMsg("Join request has been rejected.");
      setShowRejectForm(false);
      await loadRequest();
    } catch (err: any) {
      setErrorMsg(`Failed to reject request: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "64px", textAlign: "center", color: "var(--mid-warm-gray)", fontFamily: "var(--font-mono)" }}>
        Loading join request {requestId}...
      </div>
    );
  }

  if (errorMsg && !request) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div className="alert-banner error">
          <div style={{ fontWeight: 600 }}>Error:</div>
          <div>{errorMsg}</div>
        </div>
        <Link href="/agents/join-requests" className="btn-secondary" style={{ width: "fit-content" }}>
          Return to Join Requests
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", maxWidth: "840px", margin: "0 auto" }}>
      {/* Breadcrumb & Return */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--mid-warm-gray)" }}>
          <Link href="/agents" style={{ textDecoration: "underline" }}>
            Agents
          </Link>
          <span>/</span>
          <Link href="/agents/join-requests" style={{ textDecoration: "underline" }}>
            Join Requests
          </Link>
          <span>/</span>
          <span style={{ color: "var(--near-black-ink)", fontWeight: 500 }}>{request?.agentName}</span>
        </div>

        <Link href="/agents/join-requests" className="btn-secondary" style={{ fontSize: "13px", padding: "4px 12px" }}>
          Back to Requests
        </Link>
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

      {/* Review Card */}
      <div className="harvey-card" style={{ padding: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                Agent Join Request
              </span>
            </div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "32px", fontWeight: 400, color: "var(--near-black-ink)", lineHeight: 1.15 }}>
              {request?.agentName}
            </h1>
            <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)", marginTop: "4px" }}>
              Submitted: {request && new Date(request.createdAt).toLocaleString()}
            </div>
          </div>

          <span
            className={`status-pill ${
              request?.status === "APPROVED"
                ? "approved"
                : request?.status === "PENDING_APPROVAL"
                ? "pending"
                : "rejected"
            }`}
          >
            <span className="status-dot-inner" />
            {request?.status === "PENDING_APPROVAL" ? "WAITING FOR APPROVAL" : request?.status}
          </span>
        </div>

        {/* Spec Overview */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", background: "#f7f6f4", padding: "16px", borderRadius: "var(--radius-sm)", border: "1px solid var(--warm-gray-border)", marginBottom: "24px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Agent Framework</div>
            <div style={{ fontWeight: 600, fontSize: "14px", marginTop: "2px" }}>{request?.agentType}</div>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Runtime Version</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", marginTop: "2px" }}>v{request?.agentVersion || "1.0.0"}</div>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Protocol</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", marginTop: "2px" }}>{request?.gatewayProtocol?.toUpperCase() || "ACP"}</div>
          </div>
          <div>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Request ID</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", marginTop: "2px" }}>{request?.id}</div>
          </div>
        </div>

        {/* Requested Capabilities Matrix */}
        <div style={{ marginBottom: "28px" }}>
          <h3 className="panel-title" style={{ marginBottom: "8px" }}>
            Requested Operational Capabilities ({request?.declaredCapabilities?.length || 0})
          </h3>
          <p className="body-subtle" style={{ marginBottom: "14px" }}>
            The agent proposes to execute actions within these operational scopes. Review whether this agent should have permission to inspect or mutate these infrastructure services.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {request?.declaredCapabilities && request.declaredCapabilities.length > 0 ? (
              request.declaredCapabilities.map((cap) => (
                <div
                  key={cap}
                  style={{
                    padding: "10px 14px",
                    background: "#ffffff",
                    border: "1px solid var(--warm-gray-border)",
                    borderRadius: "var(--radius-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                    <span className="code-inline" style={{ fontSize: "13px", fontWeight: 500 }}>
                      {cap}
                    </span>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                    Declared
                  </span>
                </div>
              ))
            ) : (
              <div style={{ color: "var(--mid-warm-gray)", fontSize: "13px", padding: "12px", background: "#f7f6f4", borderRadius: "var(--radius-sm)" }}>
                No specific capabilities declared in join manifest.
              </div>
            )}
          </div>
        </div>

        {/* Actions & Decision Gate */}
        {request?.status === "PENDING_APPROVAL" ? (
          <div style={{ borderTop: "1px solid var(--warm-gray-border)", paddingTop: "20px" }}>
            {!showRejectForm ? (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="btn-primary"
                  style={{ padding: "10px 24px", fontSize: "14px" }}
                >
                  {submitting ? "Approving..." : "Approve Agent"}
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={submitting}
                  className="btn-danger"
                  style={{ padding: "10px 18px", fontSize: "14px" }}
                >
                  Reject Request
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "#fff5f5", padding: "16px", borderRadius: "var(--radius-sm)", border: "1px solid #fca5a5" }}>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--status-danger-text)" }}>
                  Reject Agent Join Request
                </div>
                <div className="form-group">
                  <label className="form-label">Operator Reason for Rejection</label>
                  <input
                    type="text"
                    placeholder="e.g. Excessive capabilities declared or unverified agent source"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="btn-danger"
                    style={{ padding: "8px 16px" }}
                  >
                    {submitting ? "Rejecting..." : "Confirm Rejection"}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(false)}
                    disabled={submitting}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : request?.status === "APPROVED" ? (
          <div style={{ borderTop: "1px solid var(--warm-gray-border)", paddingTop: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
              <div style={{ color: "#16a34a", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Request Approved. Sovereign identity minted:</span>
                <span className="code-inline">{request.agentId}</span>
              </div>
              {request.agentId && (
                <Link href={`/agents/${request.agentId}`} className="btn-secondary" style={{ fontSize: "13px" }}>
                  Open Agent Dossier
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div style={{ borderTop: "1px solid var(--warm-gray-border)", paddingTop: "18px", color: "var(--status-danger-text)", fontSize: "13.5px" }}>
            Request Rejected. Reason: {request?.rejectionReason || "Operator manual rejection"}.
          </div>
        )}
      </div>

      {/* Invariant Footer */}
      <div className="alert-banner info">
        <div style={{ display: "flex", alignItems: "center", color: "var(--near-black-ink)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div>
          <div style={{ fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "3px" }}>
            Operator Governance: Declared ≠ Authorized
          </div>
          <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: 1.5 }}>
            Approval admits the agent into your fleet, allowing it to complete its bootstrap handshake. Operational actions remain sandboxed and governed by fine-grained policies before execution against production cloud accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
