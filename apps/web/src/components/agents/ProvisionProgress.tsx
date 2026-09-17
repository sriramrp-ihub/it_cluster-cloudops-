"use client";

import React from "react";
import Link from "next/link";

export interface ProvisionStep {
  id: number;
  label: string;
  status: "pending" | "running" | "completed" | "error";
  detail?: string;
}

interface ProvisionProgressProps {
  steps: ProvisionStep[];
  isComplete: boolean;
  agentId?: string;
  mcpSseUrl?: string;
  connectorPid?: number;
  toolsDiscovered?: string[];
  errorMessage?: string | null;
  onRetry?: () => void;
}

export const ProvisionProgress: React.FC<ProvisionProgressProps> = ({
  steps,
  isComplete,
  agentId,
  mcpSseUrl,
  connectorPid,
  toolsDiscovered = [],
  errorMessage,
  onRetry
}) => {
  return (
    <div
      style={{
        maxWidth: "680px",
        margin: "0 auto",
        padding: "2rem",
        backgroundColor: "var(--pure-white)",
        borderRadius: "8px",
        border: "1px solid var(--warm-gray-border)",
        boxShadow: "0 4px 20px rgba(15, 14, 13, 0.05)"
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <h3 style={{ fontSize: "20px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "0.5rem" }}>
          {isComplete ? "Agent Provisioned Successfully" : errorMessage ? "Provisioning Interrupted" : "Auto-Provisioning Agent..."}
        </h3>
        <p style={{ fontSize: "14px", color: "var(--mid-warm-gray)" }}>
          {isComplete
            ? "Your agent sidecar is running, registered with CloudOps Gateway, and exposed via MCP."
            : errorMessage
            ? errorMessage
            : "Executing cryptographic handshake, sidecar process spawning, and MCP readiness probes."}
        </p>
      </div>

      {/* Steps List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
        {steps.map((step) => {
          return (
            <div
              key={step.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                padding: "10px 14px",
                borderRadius: "6px",
                backgroundColor:
                  step.status === "running"
                    ? "#fafaf9"
                    : step.status === "completed"
                    ? "#f0fdf4"
                    : step.status === "error"
                    ? "#fef2f2"
                    : "transparent",
                border:
                  step.status === "running"
                    ? "1px solid var(--near-black-ink)"
                    : step.status === "completed"
                    ? "1px solid #bbf7d0"
                    : step.status === "error"
                    ? "1px solid #fecaca"
                    : "1px solid #f2f1ef"
              }}
            >
              {/* Icon Status */}
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor:
                    step.status === "completed"
                      ? "#16a34a"
                      : step.status === "running"
                      ? "var(--near-black-ink)"
                      : step.status === "error"
                      ? "#dc2626"
                      : "#e5e4e2",
                  color: "#ffffff"
                }}
              >
                {step.status === "completed" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : step.status === "running" ? (
                  <div
                    style={{
                      width: "12px",
                      height: "12px",
                      border: "2px solid #ffffff",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite"
                    }}
                  />
                ) : step.status === "error" ? (
                  "!"
                ) : (
                  step.id
                )}
              </div>

              {/* Step Label */}
              <div style={{ flex: 1 }}>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: step.status === "running" || step.status === "completed" ? 600 : 400,
                    color:
                      step.status === "completed"
                        ? "#15803d"
                        : step.status === "running"
                        ? "var(--near-black-ink)"
                        : step.status === "error"
                        ? "#b91c1c"
                        : "var(--muted-gray)"
                  }}
                >
                  {step.label}
                </span>
                {step.detail && (
                  <span style={{ display: "block", fontSize: "11px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>
                    {step.detail}
                  </span>
                )}
              </div>

              {step.status === "completed" && (
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#16a34a" }}>READY</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Success Details Card */}
      {isComplete && agentId && (
        <div
          style={{
            padding: "1.25rem",
            borderRadius: "6px",
            backgroundColor: "#fcfbf9",
            border: "1px solid var(--border-subtle)",
            marginBottom: "2rem"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>Agent ID:</span>
            <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{agentId}</span>
          </div>

          {mcpSseUrl && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>MCP SSE Endpoint:</span>
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "#0369a1" }}>{mcpSseUrl}</span>
            </div>
          )}

          {connectorPid && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>Connector Daemon PID:</span>
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)" }}>{connectorPid}</span>
            </div>
          )}

          {toolsDiscovered.length > 0 && (
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: "12px", color: "var(--dark-warm-gray)", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                Discovered MCP Tools ({toolsDiscovered.length}):
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {toolsDiscovered.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      backgroundColor: "#f2f1ef",
                      padding: "2px 6px",
                      borderRadius: "4px"
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Footer */}
      <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
        {isComplete && agentId ? (
          <Link
            href={`/agents/${agentId}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 24px",
              backgroundColor: "var(--near-black-ink)",
              color: "#ffffff",
              borderRadius: "4px",
              fontWeight: 600,
              fontSize: "14px",
              textDecoration: "none"
            }}
          >
            Open Agent Dossier &amp; Test &rarr;
          </Link>
        ) : errorMessage ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: "10px 24px",
              backgroundColor: "#dc2626",
              color: "#ffffff",
              borderRadius: "4px",
              border: "none",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer"
            }}
          >
            Retry Provisioning
          </button>
        ) : null}
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
