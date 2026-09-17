"use client";

import React from "react";

interface StepInviteProps {
  inviteToken: string;
  onChange: (value: string) => void;
  errors: Record<string, string>;
  validated: boolean;
  inviteData: { tenantId: string; expiresAt: string; joinRequestId?: string } | null;
  onValidate: () => void;
}

export const StepInvite: React.FC<StepInviteProps> = ({
  inviteToken,
  onChange,
  errors,
  validated,
  inviteData,
  onValidate
}) => {
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
          htmlFor="invite-token"
          style={{ display: "block", fontSize: "13px", fontWeight: 500, color: "var(--dark-warm-gray)", marginBottom: "6px" }}
        >
          Invite Token (co_inv_...)
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
            border: errors.invite
              ? "1px solid #dc2626"
              : validated
              ? "1px solid #16a34a"
              : "1px solid var(--warm-gray-border)",
            backgroundColor: validated ? "#f0fdf4" : "var(--pure-white)",
            color: "var(--near-black-ink)",
            outline: "none",
            transition: "border-color 0.15s, background-color 0.15s"
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !validated) {
              onValidate();
            }
          }}
        />
        {errors.invite && (
          <p style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626" }}>{errors.invite}</p>
        )}
        {validated && (
          <p style={{ marginTop: "6px", fontSize: "12px", color: "#16a34a" }}>
            ✓ Token validated successfully
          </p>
        )}
      </div>

      {validated && inviteData && (
        <div
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            backgroundColor: "#fcfbf9",
            border: "1px solid var(--warm-gray-border)",
            borderRadius: "6px"
          }}
        >
          <h3 style={{ fontSize: "13px", fontWeight: 600, color: "var(--dark-warm-gray)", marginBottom: "0.75rem" }}>
            Invite Details
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "13px" }}>
            <div>
              <span style={{ color: "var(--muted-gray)" }}>Tenant:</span>
              <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{inviteData.tenantId}</span>
            </div>
            <div>
              <span style={{ color: "var(--muted-gray)" }}>Expires:</span>
              <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)" }}>
                {inviteData.expiresAt ? new Date(inviteData.expiresAt).toLocaleString() : "Not specified"}
              </span>
            </div>
            {inviteData.joinRequestId && (
              <div style={{ gridColumn: "span 2" }}>
                <span style={{ color: "var(--muted-gray)" }}>Existing Join Request:</span>
                <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{inviteData.joinRequestId}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button
          type="button"
          onClick={onValidate}
          disabled={validated || !inviteToken.trim()}
          style={{
            padding: "12px 24px",
            backgroundColor: validated ? "#e5e4e2" : "var(--near-black-ink)",
            color: "#ffffff",
            borderRadius: "6px",
            border: "none",
            fontWeight: 600,
            fontSize: "14px",
            cursor: validated ? "not-allowed" : "pointer",
            opacity: validated ? 0.5 : 1,
            transition: "opacity 0.15s, background-color 0.15s"
          }}
        >
          {validated ? "Token Validated" : "Validate & Continue"}
        </button>
      </div>

      <div style={{ marginTop: "2rem", padding: "1rem", backgroundColor: "#fcfbf9", borderRadius: "6px", border: "1px solid var(--warm-gray-border)" }}>
        <h4 style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)", marginBottom: "0.5rem" }}>
          How to get an invite token
        </h4>
        <ol style={{ fontSize: "13px", color: "var(--dark-warm-gray)", paddingLeft: "1.25rem", lineHeight: "1.8" }}>
          <li>Ask your CloudOps operator to create an invite via the API:</li>
          <li style={{ marginTop: "0.5rem", paddingLeft: "1rem", fontFamily: "var(--font-mono)", fontSize: "12px", color: "#0369a1" }}>
            {"POST /v1/agent-invites { tenantId, expiresInSeconds, agentName?, agentType? }"}
          </li>
          <li style={{ marginTop: "0.5rem" }}>Operator receives: <code style={{ fontFamily: "var(--font-mono)", background: "#f2f1ef", padding: "1px 4px", borderRadius: "3px" }}>co_inv_xxxxxxxxxxxxxxxx</code></li>
          <li style={{ marginTop: "0.5rem" }}>Paste that token above and click "Validate & Continue"</li>
        </ol>
      </div>
    </div>
  );
};