"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AgentItem } from "../../lib/api";

interface AgentCardProps {
  agent: AgentItem;
  onConnect: (agentId: string) => Promise<void>;
  onOpenTest: (agent: AgentItem) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onConnect,
  onOpenTest
}) => {
  const [connecting, setConnecting] = useState(false);

  const handleConnectClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConnecting(true);
    try {
      await onConnect(agent.id);
    } finally {
      setConnecting(false);
    }
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
        padding: "1.25rem",
        backgroundColor: "var(--pure-white)",
        borderRadius: "8px",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: "1rem",
        boxShadow: "0 1px 3px rgba(15, 14, 13, 0.03)",
        transition: "all 0.15s ease"
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
          <div>
            <Link
              href={`/agents/${agent.id}`}
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--near-black-ink)",
                textDecoration: "none"
              }}
            >
              {agent.name}
            </Link>
            <span
              style={{
                display: "block",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--muted-gray)",
                marginTop: "2px"
              }}
            >
              {agent.id}
            </span>
          </div>

          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "4px",
              backgroundColor: badge.bg,
              color: badge.color
            }}
          >
            {badge.label}
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "0.75rem" }}>
          <span
            style={{
              fontSize: "11px",
              backgroundColor: "#f2f1ef",
              color: "var(--dark-warm-gray)",
              padding: "2px 6px",
              borderRadius: "3px",
              textTransform: "uppercase",
              fontWeight: 600
            }}
          >
            {agent.type}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--muted-gray)",
              fontFamily: "var(--font-mono)",
              display: "flex",
              alignItems: "center"
            }}
          >
            v{agent.version} • {agent.runtimeProtocol.toUpperCase()}
          </span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "0.75rem",
          borderTop: "1px solid #f2f1ef"
        }}
      >
        <Link
          href={`/agents/${agent.id}`}
          style={{
            fontSize: "13px",
            color: "var(--near-black-ink)",
            fontWeight: 500,
            textDecoration: "none"
          }}
        >
          View Dossier &rarr;
        </Link>

        <div style={{ display: "flex", gap: "6px" }}>
          {agent.status !== "CONNECTED" && (
            <button
              type="button"
              onClick={handleConnectClick}
              disabled={connecting}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                borderRadius: "4px",
                border: "1px solid var(--near-black-ink)",
                backgroundColor: "var(--near-black-ink)",
                color: "#ffffff",
                cursor: connecting ? "not-allowed" : "pointer",
                fontWeight: 500
              }}
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onOpenTest(agent);
            }}
            style={{
              padding: "4px 10px",
              fontSize: "12px",
              borderRadius: "4px",
              border: "1px solid var(--warm-gray-border)",
              backgroundColor: "transparent",
              color: "var(--dark-warm-gray)",
              cursor: "pointer",
              fontWeight: 500
            }}
          >
            Test
          </button>
        </div>
      </div>
    </div>
  );
};
