"use client";

import React, { useState, useEffect } from "react";
import { testAgent } from "../../lib/api";
import { useOperator } from "../../auth/OperatorContext";

interface TestAgentModalProps {
  agentId: string;
  agentName: string;
  isOpen: boolean;
  onClose: () => void;
}

export const TestAgentModal: React.FC<TestAgentModalProps> = ({
  agentId,
  agentName,
  isOpen,
  onClose
}) => {
  const { session } = useOperator();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; mcpTools?: string[]; error?: string } | null>(null);

  const runTest = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await testAgent(agentId, session?.tenantId, session?.operatorId);
      setResult(res);
    } catch (err: any) {
      setResult({ success: false, error: err?.message || "Connection failed" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runTest();
    } else {
      setResult(null);
    }
  }, [isOpen, agentId]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 14, 13, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        backdropFilter: "blur(2px)"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor: "var(--pure-white)",
          borderRadius: "8px",
          padding: "1.75rem",
          boxShadow: "0 10px 30px rgba(15, 14, 13, 0.15)",
          border: "1px solid var(--warm-gray-border)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)" }}>
            Testing Connection: {agentName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "18px",
              color: "var(--muted-gray)"
            }}
          >
            &times;
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                margin: "0 auto 1rem",
                border: "3px solid #f2f1ef",
                borderTopColor: "var(--near-black-ink)",
                borderRadius: "50%",
                animation: "modal-spin 0.8s linear infinite"
              }}
            />
            <p style={{ fontSize: "14px", color: "var(--dark-warm-gray)", fontWeight: 500 }}>
              Testing agent connection &amp; discovering MCP tools...
            </p>
            <p style={{ fontSize: "12px", color: "var(--muted-gray)", marginTop: "4px" }}>
              Connecting to SSE endpoint and performing handshake...
            </p>
          </div>
        ) : result?.success ? (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 14px",
                borderRadius: "6px",
                backgroundColor: "#f0fdf4",
                border: "1px solid #bbf7d0",
                marginBottom: "1rem"
              }}
            >
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "#16a34a",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px"
                }}
              >
                ✓
              </div>
              <div>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#166534" }}>
                  Connected to Agent Successfully
                </span>
                <span style={{ display: "block", fontSize: "11px", color: "#15803d" }}>
                  MCP SSE protocol handshake and read tool probe passed.
                </span>
              </div>
            </div>

            {result.mcpTools && result.mcpTools.length > 0 && (
              <div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--dark-warm-gray)", display: "block", marginBottom: "6px" }}>
                  Discovered MCP Tools ({result.mcpTools.length}):
                </span>
                <div
                  style={{
                    maxHeight: "180px",
                    overflowY: "auto",
                    padding: "8px",
                    backgroundColor: "#fafaf9",
                    borderRadius: "4px",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px"
                  }}
                >
                  {result.mcpTools.map((t) => (
                    <div
                      key={t}
                      style={{
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        color: "var(--near-black-ink)",
                        padding: "2px 6px"
                      }}
                    >
                      • {t}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : result ? (
          <div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "6px",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                marginBottom: "1rem"
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#991b1b" }}>
                Failed to Connect
              </span>
              <p style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                {result.error || "The connector sidecar could not be reached or returned an invalid response."}
              </p>
            </div>
            <p style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
              Ensure the connector process is active and bound to the expected MCP port.
            </p>
          </div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "1.5rem" }}>
          {result && !loading && (
            <button
              type="button"
              onClick={runTest}
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
              Re-test
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 16px",
              fontSize: "13px",
              borderRadius: "4px",
              border: "none",
              backgroundColor: "var(--near-black-ink)",
              color: "#ffffff",
              cursor: "pointer",
              fontWeight: 600
            }}
          >
            Close
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes modal-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};
