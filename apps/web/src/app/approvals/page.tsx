"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";

interface ApprovalItem {
  id: string;
  tenantId: string;
  agentId: string;
  toolName: string;
  operationType: string;
  operationPayloadHash: string;
  rawPayload: Record<string, any>;
  status: string;
  dryRunDiff?: {
    resource?: string;
    action?: string;
    current?: string;
    target?: string;
  } | null;
  createdAt: string;
  expiresAt: string;
}

export default function ApprovalsPage() {
  const { setChatContext, openChat } = useAgentChat();
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewState, setReviewState] = useState<{
    status: "idle" | "approved" | "rejected";
    approvalId?: string;
    signature?: string;
    message?: string;
  }>({ status: "idle" });
  const [showContracts, setShowContracts] = useState(false);

  useEffect(() => {
    setChatContext({
      sourcePage: "Approvals Queue"
    });
  }, [setChatContext]);

  // 1. Fetch real pending approvals from PostgreSQL
  const loadApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:3000/v1/approvals", {
        headers: { "x-tenant-id": "ten_default_tenant" }
      });
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals || []);
      }
    } catch (err) {
      console.error("Failed to load approvals", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  // 2. Cryptographic quick-approve & execute
  const handleApprove = async (approvalId: string) => {
    try {
      const res = await fetch(`http://localhost:3000/v1/approvals/${approvalId}/quick-approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "ten_default_tenant"
        },
        body: JSON.stringify({ reviewedBy: "cloudops_operator_admin" })
      });

      if (res.ok) {
        const data = await res.json();
        setReviewState({
          status: "approved",
          approvalId,
          signature: data.operatorSignature,
          message: "Operation cryptographically signed with operator Ed25519 key and executed via Tool Gateway."
        });
        loadApprovals();
      }
    } catch (err) {
      console.error("Failed to approve", err);
    }
  };

  // 3. Reject operation
  const handleReject = async (approvalId: string) => {
    try {
      const res = await fetch(`http://localhost:3000/v1/approvals/${approvalId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "ten_default_tenant"
        },
        body: JSON.stringify({
          reviewedBy: "cloudops_operator_admin",
          reason: "Operator rejected remediation mutation"
        })
      });

      if (res.ok) {
        setReviewState({
          status: "rejected",
          approvalId,
          message: "Mutation cancelled. Agent notified that authorization was denied."
        });
        loadApprovals();
      }
    } catch (err) {
      console.error("Failed to reject", err);
    }
  };

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
              Governance & Authorization
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Approvals Queue
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Cryptographically bounded operator authorizations for cloud infrastructure mutations.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openChat("Show me pending approvals")}
          className="btn-secondary"
          style={{ fontSize: "13px" }}
        >
          Ask CloudOps about Approvals
        </button>
      </div>

      {/* 2. Feedback Alert */}
      {reviewState.status === "approved" && (
        <div className="alert-banner success" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            <strong>Action Cryptographically Authorized & Executed:</strong> {reviewState.message}
          </div>
          {reviewState.signature && (
            <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", opacity: 0.9 }}>
              Ed25519 Digital Signature: <code>{reviewState.signature}</code>
            </div>
          )}
        </div>
      )}

      {reviewState.status === "rejected" && (
        <div className="alert-banner error">
          <div>
            <strong>Action Rejected:</strong> {reviewState.message}
          </div>
        </div>
      )}

      {/* 3. Requires Your Attention Queue */}
      <div>
        <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
          Pending Authorizations ({approvals.length})
        </div>

        {approvals.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {approvals.map((appr) => {
              const diff = appr.dryRunDiff;
              const serviceName = appr.rawPayload?.service || "starvision-motors";
              const clusterName = appr.rawPayload?.cluster || "cloudops-test";
              const currentTag = diff?.current || "starvision-motors:2 (Broken manifest)";
              const targetTag = diff?.target || "starvision-motors:1 (Stable baseline)";

              return (
                <div key={appr.id} className="harvey-card" style={{ padding: "24px 28px", borderLeft: "3px solid #d97706" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "16px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                          Rollback Service: {serviceName}
                        </h2>
                        <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 7px", borderRadius: "var(--radius-sm)", fontWeight: 700 }}>
                          RISK: CRITICAL
                        </span>
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
                        Agent: <strong>Hermes SRE ({appr.agentId})</strong> · Cluster: <strong>{clusterName}</strong> · Tool: <code>{appr.toolName}</code>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "12px", fontFamily: "var(--font-mono)", fontSize: "12.5px" }}>
                      <span>Current: <strong>{currentTag}</strong></span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                      <span>Target: <strong style={{ color: "#16a34a" }}>{targetTag}</strong></span>
                    </div>
                  </div>

                  {/* Details Box */}
                  <div style={{ padding: "16px", background: "#fcfbf9", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                    <div>
                      <span style={{ color: "var(--mid-warm-gray)" }}>Reason:</span>{" "}
                      <span style={{ color: "var(--near-black-ink)" }}>
                        Remediate ContainerImagePullFailure by updating task definition revision to stable baseline.
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--mid-warm-gray)" }}>Impact:</span>{" "}
                      <span style={{ color: "var(--near-black-ink)" }}>
                        ECS service <code>{serviceName}</code> will trigger a rolling deployment to <code>{targetTag}</code>.
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--mid-warm-gray)" }}>Payload SHA-256:</span>{" "}
                      <code style={{ fontSize: "11px" }}>{appr.operationPayloadHash}</code>
                    </div>
                    <div>
                      <span style={{ color: "var(--mid-warm-gray)" }}>Policy Gate:</span>{" "}
                      <span style={{ color: "var(--near-black-ink)" }}>
                        Mutations exceeding read-only boundary require explicit operator Ed25519 digital signature.
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => handleApprove(appr.id)}
                      className="btn-primary"
                      style={{ fontSize: "13px" }}
                    >
                      Authorize & Execute (Ed25519 Signed)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(appr.id)}
                      className="btn-secondary"
                      style={{ fontSize: "13px" }}
                    >
                      Reject Mutation
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="harvey-card" style={{ padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "6px" }}>
              Zero Pending Approvals
            </div>
            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", maxWidth: "520px", margin: "0 auto 16px" }}>
              All autonomous agent operations are currently within baseline read-only governance. When an investigation proposes an infrastructure mutation, it will appear here for cryptographic authorization.
            </p>
            <Link
              href="/investigate"
              className="btn-secondary"
              style={{ fontSize: "13px", display: "inline-block", textDecoration: "none" }}
            >
              Go to Investigations Workspace
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
