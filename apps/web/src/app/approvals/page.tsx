"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";

export default function ApprovalsPage() {
  const { setChatContext, openChat } = useAgentChat();
  const [activeApproval, setActiveApproval] = useState<any | null>({
    id: "appr_7b4e91f0",
    action: "Scale payments tasks",
    service: "payments",
    agent: "Hermes SRE",
    current: "3 tasks",
    requested: "5 tasks",
    risk: "Medium",
    reason: "Increase capacity to mitigate traffic spike and elevated P95 latency.",
    impact: "2 additional Fargate tasks will be provisioned in us-east-1.",
    policy: "High-risk compute scaling requires explicit operator authorization."
  });

  const [reviewState, setReviewState] = useState<"idle" | "approved" | "rejected">("idle");
  const [showContracts, setShowContracts] = useState(false);

  useEffect(() => {
    setChatContext({
      sourcePage: "Approvals Queue"
    });
  }, [setChatContext]);

  const handleApprove = () => {
    setReviewState("approved");
    setTimeout(() => {
      setActiveApproval(null);
    }, 2500);
  };

  const handleReject = () => {
    setReviewState("rejected");
    setTimeout(() => {
      setActiveApproval(null);
    }, 2500);
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
          Ask CloudOps about Approvals →
        </button>
      </div>

      {/* 2. Feedback Alert */}
      {reviewState === "approved" && (
        <div className="alert-banner success">
          <div>
            <strong>Action Approved:</strong> Operation authorization signed and dispatched to Tool Gateway.
          </div>
        </div>
      )}

      {reviewState === "rejected" && (
        <div className="alert-banner error">
          <div>
            <strong>Action Rejected:</strong> Mutation cancelled. Agent notified that scaling authorization was denied.
          </div>
        </div>
      )}

      {/* 3. Requires Your Attention Queue */}
      <div>
        <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
          Requires Your Attention
        </div>

        {activeApproval ? (
          <div className="harvey-card" style={{ padding: "24px 28px", borderLeft: "3px solid #d97706" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                    {activeApproval.action}
                  </h2>
                  <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 7px", borderRadius: "var(--radius-sm)", fontWeight: 700 }}>
                    RISK: {activeApproval.risk}
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
                  Agent: <strong>{activeApproval.agent}</strong> · Target: <strong>{activeApproval.service}</strong>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
                <span>Current: <strong>{activeApproval.current}</strong></span>
                <span>→</span>
                <span>Requested: <strong>{activeApproval.requested}</strong></span>
              </div>
            </div>

            {/* Details Box */}
            <div style={{ padding: "16px", background: "#fcfbf9", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
              <div>
                <span style={{ color: "var(--mid-warm-gray)" }}>Reason:</span>{" "}
                <span style={{ color: "var(--near-black-ink)" }}>{activeApproval.reason}</span>
              </div>
              <div>
                <span style={{ color: "var(--mid-warm-gray)" }}>Impact:</span>{" "}
                <span style={{ color: "var(--near-black-ink)" }}>{activeApproval.impact}</span>
              </div>
              <div>
                <span style={{ color: "var(--mid-warm-gray)" }}>Policy Requirement:</span>{" "}
                <span style={{ color: "var(--near-black-ink)" }}>{activeApproval.policy}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                onClick={handleReject}
                className="btn-danger"
                style={{ padding: "8px 20px", fontSize: "13px" }}
              >
                Reject Request
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="btn-primary"
                style={{ padding: "8px 24px", fontSize: "13px" }}
              >
                Approve & Execute →
              </button>
            </div>
          </div>
        ) : (
          <div className="harvey-card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "#edece9", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginBottom: "12px" }}>
              ✓
            </div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--near-black-ink)", marginBottom: "6px" }}>
              Approval Queue Clear
            </div>
            <p className="body-subtle" style={{ maxWidth: "460px", margin: "0 auto 20px auto", fontSize: "13px" }}>
              No pending operational authorizations are queued. High-risk cloud operations requiring human operator approval will automatically appear here.
            </p>
            <Link href="/" className="btn-secondary">
              ← Return to Operational Overview
            </Link>
          </div>
        )}
      </div>

      {/* 4. Progressive Disclosure: Cryptographic Policy Guarantees */}
      <div className="harvey-card" style={{ padding: "18px 24px" }}>
        <button
          type="button"
          onClick={() => setShowContracts(!showContracts)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--near-black-ink)",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <span>{showContracts ? "▾" : "▸"}</span>
          <span>Cryptographic Guarantees & Schema Contracts</span>
        </button>

        {showContracts && (
          <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid var(--warm-gray-border)", display: "flex", flexDirection: "column", gap: "10px", fontSize: "12.5px", color: "var(--mid-warm-gray)" }}>
            <p style={{ margin: 0 }}>
              CloudOps approvals are cryptographically operation-bound. Every approval is anchored to the canonical SHA-256 hash of the exact tool invocation payload (<code className="code-inline">operation_payload_hash</code>).
            </p>
            <p style={{ margin: 0 }}>
              Approvals are consumed atomically by the Tool Gateway. Once executed, an approval cannot be replayed, transferred, or executed after expiration.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
