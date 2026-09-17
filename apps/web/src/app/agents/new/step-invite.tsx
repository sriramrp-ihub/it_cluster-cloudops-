"use client";

import React, { useState } from "react";

export interface StepInviteProps {
  inviteToken: string;
  onChange: (value: string) => void;
  errors: Record<string, string>;
  validated: boolean;
  inviteData: { tenantId: string; expiresAt: string; joinRequestId?: string } | null;
  onValidate: () => void;
  onContinue?: () => void;
  isOperator?: boolean;
  loadingInvite?: boolean;
  onCreateInvite?: () => void;
}

export const StepInvite: React.FC<StepInviteProps> = ({
  inviteToken,
  onChange,
  errors,
  validated,
  inviteData,
  onValidate,
  onContinue,
  isOperator = false,
  loadingInvite = false,
  onCreateInvite
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyToken = () => {
    if (inviteToken) {
      navigator.clipboard.writeText(inviteToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // State A: Token is already validated (Success State)
  if (validated) {
    return (
      <div style={{ maxWidth: "640px" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "24px",
                height: "24px",
                borderRadius: "50%",
                backgroundColor: "#16a34a",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 700
              }}
            >
              ✓
            </span>
            <h2 style={{ fontSize: "20px", fontWeight: 600, color: "var(--near-black-ink)", margin: 0 }}>
              Invite Token Validated
            </h2>
          </div>
          <p style={{ fontSize: "14px", color: "var(--mid-warm-gray)", margin: 0 }}>
            This token is verified and active. The agent is authorized to join tenant{" "}
            <strong style={{ color: "var(--near-black-ink)" }}>{inviteData?.tenantId || "default"}</strong>.
          </p>
        </div>

        {/* Token Details Card */}
        <div
          style={{
            padding: "1.25rem",
            backgroundColor: "#fcfbf9",
            border: "1px solid var(--warm-gray-border)",
            borderRadius: "6px",
            marginBottom: "1.5rem"
          }}
        >
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--dark-warm-gray)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Active Token
              </span>
              <button
                type="button"
                onClick={handleCopyToken}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "12px",
                  color: "#0284c7",
                  cursor: "pointer",
                  fontWeight: 500,
                  padding: 0
                }}
              >
                {copied ? "Copied!" : "Copy Token"}
              </button>
            </div>
            <input
              type="text"
              readOnly
              value={inviteToken}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "13px",
                fontFamily: "var(--font-mono)",
                borderRadius: "6px",
                border: "1px solid #16a34a",
                backgroundColor: "#f0fdf4",
                color: "#166534",
                outline: "none"
              }}
            />
          </div>

          {inviteData && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "13px" }}>
              <div>
                <span style={{ color: "var(--muted-gray)" }}>Tenant Scope:</span>
                <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  {inviteData.tenantId}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--muted-gray)" }}>Expires:</span>
                <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", color: "var(--dark-warm-gray)" }}>
                  {inviteData.expiresAt ? new Date(inviteData.expiresAt).toLocaleString() : "24 hours"}
                </span>
              </div>
              {inviteData.joinRequestId && (
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "var(--muted-gray)" }}>Join Request:</span>
                  <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                    {inviteData.joinRequestId}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <button
            type="button"
            onClick={onContinue || onValidate}
            style={{
              padding: "12px 28px",
              backgroundColor: "var(--near-black-ink)",
              color: "#ffffff",
              borderRadius: "6px",
              border: "none",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
              transition: "opacity 0.15s, background-color 0.15s"
            }}
          >
            Continue &rarr;
          </button>
          <button
            type="button"
            onClick={() => onChange("")}
            style={{
              padding: "12px 16px",
              backgroundColor: "transparent",
              color: "var(--mid-warm-gray)",
              borderRadius: "6px",
              border: "none",
              fontSize: "13px",
              cursor: "pointer"
            }}
          >
            Use a different token
          </button>
        </div>
      </div>
    );
  }

  // State B: Operator Experience
  if (isOperator) {
    return (
      <div style={{ maxWidth: "640px" }}>
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        ` }} />

        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "0.5rem" }}>
            Agent Onboarding Invitation
          </h2>
          <p style={{ fontSize: "14px", color: "var(--mid-warm-gray)", lineHeight: "1.5" }}>
            Every autonomous agent requires a cryptographic invite token to join the control plane.
            As an operator, you can generate one instantly or enter an existing token.
          </p>
        </div>

        {/* Operator Quick Generation Card */}
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#fcfbf9",
            border: "1px solid var(--warm-gray-border)",
            borderRadius: "8px",
            marginBottom: "2rem",
            boxShadow: "0 1px 2px rgba(15, 14, 13, 0.04)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "#0369a1",
                backgroundColor: "#e0f2fe",
                padding: "2px 8px",
                borderRadius: "4px"
              }}
            >
              Operator Action
            </span>
          </div>

          <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "0.5rem" }}>
            Generate New Invite Token
          </h3>
          <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", marginBottom: "1.25rem", lineHeight: "1.5" }}>
            Directly provision a high-entropy invite token with 24-hour TTL under your current tenant session.
            The token will be auto-filled and validated immediately.
          </p>

          <button
            type="button"
            onClick={onCreateInvite}
            disabled={loadingInvite}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "12px 24px",
              backgroundColor: loadingInvite ? "#4b5563" : "var(--near-black-ink)",
              color: "#ffffff",
              borderRadius: "6px",
              border: "none",
              fontWeight: 600,
              fontSize: "14px",
              cursor: loadingInvite ? "not-allowed" : "pointer",
              transition: "all 0.15s ease"
            }}
          >
            {loadingInvite ? (
              <>
                <svg
                  style={{
                    width: "16px",
                    height: "16px",
                    animation: "spin 1s linear infinite"
                  }}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    style={{ opacity: 0.25 }}
                  />
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    style={{ opacity: 0.75 }}
                  />
                </svg>
                <span>Generating Token...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Generate New Invite Token</span>
              </>
            )}
          </button>
        </div>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "2rem",
            color: "var(--muted-gray)",
            fontSize: "12px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px"
          }}
        >
          <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)" }} />
          <span>Or Paste Existing Token</span>
          <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)" }} />
        </div>

        {/* Manual Paste Section */}
        <div style={{ marginBottom: "1.5rem" }}>
          <label
            htmlFor="invite-token"
            style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--dark-warm-gray)", marginBottom: "6px" }}
          >
            Existing Invite Token (co_inv_...)
          </label>
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              id="invite-token"
              type="text"
              value={inviteToken}
              onChange={(e) => onChange(e.target.value)}
              placeholder="co_inv_abcdefghijklmnopqrstuvwxyz123456..."
              style={{
                flex: 1,
                padding: "10px 14px",
                fontSize: "13px",
                fontFamily: "var(--font-mono)",
                borderRadius: "6px",
                border: errors.invite
                  ? "1px solid #dc2626"
                  : "1px solid var(--warm-gray-border)",
                backgroundColor: "var(--pure-white)",
                color: "var(--near-black-ink)",
                outline: "none"
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && inviteToken.trim()) {
                  onValidate();
                }
              }}
            />
            <button
              type="button"
              onClick={onValidate}
              disabled={!inviteToken.trim()}
              style={{
                padding: "10px 18px",
                backgroundColor: inviteToken.trim() ? "var(--near-black-ink)" : "#e5e4e2",
                color: "#ffffff",
                borderRadius: "6px",
                border: "none",
                fontWeight: 600,
                fontSize: "13px",
                cursor: inviteToken.trim() ? "pointer" : "not-allowed",
                opacity: inviteToken.trim() ? 1 : 0.6
              }}
            >
              Validate
            </button>
          </div>
          {errors.invite && (
            <p style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>{errors.invite}</p>
          )}
        </div>
      </div>
    );
  }

  // State C: Non-Operator Fallback (Paste Token Only)
  return (
    <div style={{ maxWidth: "640px" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "22px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "0.5rem" }}>
          Paste Operator Invite Token
        </h2>
        <p style={{ fontSize: "14px", color: "var(--mid-warm-gray)" }}>
          Obtain an invitation token from your CloudOps operator. The token is a single-use credential
          that authorizes this agent to join the control plane.
        </p>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <label
          htmlFor="invite-token-non-op"
          style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--dark-warm-gray)", marginBottom: "6px" }}
        >
          Invite Token (co_inv_...)
        </label>
        <input
          id="invite-token-non-op"
          type="text"
          value={inviteToken}
          onChange={(e) => onChange(e.target.value)}
          placeholder="co_inv_abcdefghijklmnopqrstuvwxyz123456..."
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: "14px",
            fontFamily: "var(--font-mono)",
            borderRadius: "6px",
            border: errors.invite
              ? "1px solid #dc2626"
              : "1px solid var(--warm-gray-border)",
            backgroundColor: "var(--pure-white)",
            color: "var(--near-black-ink)",
            outline: "none"
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && inviteToken.trim()) {
              onValidate();
            }
          }}
        />
        {errors.invite && (
          <p style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>{errors.invite}</p>
        )}
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          onClick={onValidate}
          disabled={!inviteToken.trim()}
          style={{
            padding: "12px 24px",
            backgroundColor: inviteToken.trim() ? "var(--near-black-ink)" : "#e5e4e2",
            color: "#ffffff",
            borderRadius: "6px",
            border: "none",
            fontWeight: 600,
            fontSize: "14px",
            cursor: inviteToken.trim() ? "pointer" : "not-allowed",
            opacity: inviteToken.trim() ? 1 : 0.5
          }}
        >
          Validate & Continue
        </button>
      </div>

      <div
        style={{
          marginTop: "2rem",
          padding: "1rem",
          backgroundColor: "#fcfbf9",
          borderRadius: "6px",
          border: "1px solid var(--warm-gray-border)"
        }}
      >
        <h4
          style={{
            fontSize: "12px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--mid-warm-gray)",
            marginBottom: "0.5rem"
          }}
        >
          How to get an invite token
        </h4>
        <ol style={{ fontSize: "13px", color: "var(--dark-warm-gray)", paddingLeft: "1.25rem", lineHeight: "1.8" }}>
          <li>Ask your CloudOps operator to create an invite via the API:</li>
          <li style={{ marginTop: "0.5rem", paddingLeft: "1rem", fontFamily: "var(--font-mono)", fontSize: "12px", color: "#0369a1" }}>
            {"POST /v1/agent-invites { ttlSeconds: 86400, agentName?, agentType? }"}
          </li>
          <li style={{ marginTop: "0.5rem" }}>
            Operator receives: <code style={{ fontFamily: "var(--font-mono)", background: "#f2f1ef", padding: "1px 4px", borderRadius: "3px" }}>co_inv_xxxxxxxxxxxxxxxx</code>
          </li>
          <li style={{ marginTop: "0.5rem" }}>Paste that token above and click "Validate & Continue"</li>
        </ol>
      </div>
    </div>
  );
};