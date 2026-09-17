"use client";

import React, { useState } from "react";

interface StepInviteProps {
  inviteToken: string;
  onChange: (value: string) => void;
  errors: Record<string, string>;
  validated: boolean;
  inviteData: { tenantId: string; expiresAt: string; joinRequestId?: string } | null;
  onValidate: () => void;
  onContinue?: () => void;
  onCreateInvite?: () => Promise<void>;
  isOperator?: boolean;
  loadingInvite?: boolean;
}

export const StepInvite: React.FC<StepInviteProps> = ({
  inviteToken,
  onChange,
  errors,
  validated,
  inviteData,
  onValidate,
  onContinue,
  onCreateInvite,
  isOperator = false,
  loadingInvite = false
}) => {
  if (validated && inviteData) {
    return (
      <div style={{ maxWidth: "640px" }}>
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "0.5rem" }}>
            ✓ Invite Token Validated
          </h2>
          <div style={{ padding: "1rem", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "6px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "13px" }}>
              <div>
                <span style={{ color: "var(--muted-gray)" }}>Tenant:</span>{" "}
                <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)" }}>{inviteData.tenantId}</span>
              </div>
              <div>
                <span style={{ color: "var(--muted-gray)" }}>Expires:</span>{" "}
                <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)" }}>
                  {new Date(inviteData.expiresAt).toLocaleString()}
                </span>
              </div>
              {inviteData.joinRequestId && (
                <div style={{ gridColumn: "span 2" }}>
                  <span style={{ color: "var(--muted-gray)" }}>Existing Join Request:</span>{" "}
                  <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)" }}>{inviteData.joinRequestId}</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: "2rem" }}>
            <button
              type="button"
              onClick={onContinue || onValidate}
              style={{
                padding: "12px 24px",
                backgroundColor: "var(--near-black-ink)",
                color: "#fff",
                borderRadius: "6px",
                border: "none",
                fontWeight: 600,
                fontSize: "14px",
                cursor: "pointer"
              }}
            >
              Continue to Basic Info →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "640px" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "22px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "0.5rem" }}>
          Agent Invitation
        </h2>
        <p style={{ fontSize: "14px", color: "var(--mid-warm-gray)" }}>
          {isOperator
            ? "Generate a new invite token or paste an existing one."
            : "Paste the invitation token provided by your CloudOps operator."}
        </p>
      </div>

      {isOperator && onCreateInvite && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            backgroundColor: "#fcfbf9",
            border: "1px solid var(--border-subtle)",
            borderRadius: "6px"
          }}
        >
          <button
            type="button"
            onClick={onCreateInvite}
            disabled={loadingInvite}
            style={{
              width: "100%",
              padding: "14px 24px",
              backgroundColor: "var(--near-black-ink)",
              color: "#fff",
              borderRadius: "6px",
              border: "none",
              fontWeight: 600,
              fontSize: "15px",
              cursor: loadingInvite ? "not-allowed" : "pointer",
              opacity: loadingInvite ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px"
            }}
          >
            {loadingInvite ? (
              <>
                <span
                  style={{
                    width: "16px",
                    height: "16px",
                    border: "2px solid #fff",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite"
                  }}
                />
                Generating invite token...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Generate New Invite Token
              </>
            )}
          </button>
          <p style={{ marginTop: "8px", fontSize: "12px", color: "var(--mid-warm-gray)", textAlign: "center" }}>
            Creates a 24-hour invite token for this tenant
          </p>
        </div>
      )}

      <div style={{ marginBottom: "1.5rem" }}>
        <label
          htmlFor="invite-token"
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--dark-warm-gray)",
            marginBottom: "6px"
          }}
        >
          {isOperator ? "Or Paste Existing Invite Token (co_inv_...)" : "Invite Token (co_inv_...)"}
        </label>
        <input
          id="invite-token"
          type="text"
          value={inviteToken}
          onChange={(e) => onChange(e.target.value)}
          placeholder="co_inv_abcdefghijklmnopqrstuvwxyz123456..."
          disabled={validated}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: "14px",
            fontFamily: "var(--font-mono)",
            borderRadius: "6px",
            border: errors.invite ? "1px solid #dc2626" : "1px solid var(--warm-gray-border)",
            backgroundColor: "var(--pure-white)",
            color: "var(--near-black-ink)",
            outline: "none"
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !validated) onValidate();
          }}
        />
        {errors.invite && <p style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>{errors.invite}</p>}
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <button
          type="button"
          onClick={onValidate}
          disabled={validated || !inviteToken.trim()}
          style={{
            padding: "12px 24px",
            backgroundColor: validated ? "#e5e4e2" : "var(--near-black-ink)",
            color: "#fff",
            borderRadius: "6px",
            border: "none",
            fontWeight: 600,
            fontSize: "14px",
            cursor: validated ? "not-allowed" : "pointer",
            opacity: validated ? 0.5 : 1
          }}
        >
          {validated ? "Token Validated" : "Validate & Continue"}
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
          How It Works
        </h4>
        <ol style={{ fontSize: "13px", color: "var(--dark-warm-gray)", paddingLeft: "1.25rem", lineHeight: "1.8" }}>
          <li>
            {isOperator ? (
              <>
                Click <strong>Generate New Invite Token</strong> above
              </>
            ) : (
              "Ask your CloudOps operator to create an invite via:"
            )}
          </li>
          {!isOperator && (
            <li
              style={{
                marginTop: "0.5rem",
                paddingLeft: "1rem",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "#0369a1"
              }}
            >
              {"POST /v1/agent-invites { tenantId, expiresInSeconds, agentName?, agentType? }"}
            </li>
          )}
          <li style={{ marginTop: "0.5rem" }}>
            Operator receives:{" "}
            <code style={{ fontFamily: "var(--font-mono)", background: "#f2f1ef", padding: "1px 4px", borderRadius: "3px" }}>
              co_inv_xxxxxxxxxxxxxxxx
            </code>
          </li>
          <li style={{ marginTop: "0.5rem" }}>
            Paste that token above and click <strong>Validate & Continue</strong>
          </li>
        </ol>
      </div>
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};