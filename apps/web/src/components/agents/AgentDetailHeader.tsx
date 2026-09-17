"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AgentItem } from "../../lib/api";

interface AgentDetailHeaderProps {
  agent: AgentItem;
  onOpenTest: () => void;
  onConnect: () => Promise<void>;
  onDelete: () => void;
  connecting?: boolean;
}

export const AgentDetailHeader: React.FC<AgentDetailHeaderProps> = ({
  agent,
  onOpenTest,
  onConnect,
  onDelete,
  connecting = false
}) => {
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    navigator.clipboard.writeText(agent.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CONNECTED":
        return { bg: "var(--near-black-ink)", color: "#ffffff", label: "CONNECTED" };
      case "REGISTERED":
      case "APPROVED":
        return { bg: "#f2f1ef", color: "var(--near-black-ink)", label: "REGISTERED" };
      case "INVITED":
        return { bg: "#fef3c7", color: "#92400e", label: "INVITED" };
      default:
        return { bg: "#fee2e2", color: "#991b1b", label: status };
    }
  };

  const badge = getStatusBadge(agent.status);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: "1.5rem",
        paddingBottom: "1.5rem",
        borderBottom: "1px solid var(--border-subtle)"
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
          <Link
            href="/agents"
            style={{
              fontSize: "12px",
              color: "var(--muted-gray)",
              textDecoration: "none"
            }}
          >
            &larr; Agents Fleet
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 600, color: "var(--near-black-ink)", letterSpacing: "-0.02em" }}>
            {agent.name}
          </h1>

          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: "4px",
              backgroundColor: badge.bg,
              color: badge.color
            }}
          >
            {badge.label}
          </span>

          <span
            style={{
              fontSize: "11px",
              backgroundColor: "#f2f1ef",
              color: "var(--dark-warm-gray)",
              padding: "3px 8px",
              borderRadius: "4px",
              textTransform: "uppercase",
              fontWeight: 600
            }}
          >
            {agent.type}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" }}>
          <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--muted-gray)" }}>
            {agent.id}
          </span>
          <button
            type="button"
            onClick={copyId}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "11px",
              color: "var(--mid-warm-gray)",
              textDecoration: "underline"
            }}
          >
            {copied ? "Copied!" : "Copy ID"}
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onOpenTest}
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: 600,
            borderRadius: "4px",
            border: "1px solid var(--warm-gray-border)",
            backgroundColor: "#ffffff",
            color: "var(--near-black-ink)",
            cursor: "pointer"
          }}
        >
          Test Agent
        </button>

        {agent.status !== "CONNECTED" && (
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            style={{
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "4px",
              border: "none",
              backgroundColor: "var(--near-black-ink)",
              color: "#ffffff",
              cursor: connecting ? "not-allowed" : "pointer"
            }}
          >
            {connecting ? "Connecting..." : "Connect"}
          </button>
        )}

        <button
          type="button"
          onClick={onDelete}
          style={{
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 500,
            borderRadius: "4px",
            border: "1px solid #fee2e2",
            backgroundColor: "#fff5f5",
            color: "#dc2626",
            cursor: "pointer"
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
};
