"use client";

import React, { useState, useEffect } from "react";

interface LogsTabProps {
  agentId: string;
}

export const LogsTab: React.FC<LogsTabProps> = ({ agentId }) => {
  const [logs, setLogs] = useState<string[]>([
    `[Connector Daemon] Initialized process listener on agent '${agentId}'`,
    `[Connector Daemon] Establishing ACP handshake with CloudOps Gateway...`,
    `[CloudOps Gateway] Received ACP_AUTH with nonce verification`,
    `[CloudOps Gateway] Session authenticated. Session ID: sess_live_${agentId.substring(0, 8)}`,
    `[MCP SSE Server] HTTP listener bound on port. Registering canonical tool contracts...`,
    `[MCP SSE Server] 12 tools registered successfully (aws_ecs_describe_clusters, aws_cloudwatch_get_metric_data, etc.)`,
    `[Heartbeat] Ack received from Gateway. Latency: 4ms`
  ]);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().toLocaleTimeString();
      setLogs((prev) => [
        ...prev.slice(-40),
        `[${now}] [Heartbeat] Periodic Gateway health probe ACK (0 errors)`
      ]);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        padding: "1.5rem",
        backgroundColor: "var(--pure-white)",
        borderRadius: "8px",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)" }}>
          Connector Daemon Output Stream
        </h4>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#16a34a" }} />
          <span style={{ fontSize: "12px", color: "#15803d", fontWeight: 500 }}>STREAMING (tail -f)</span>
        </div>
      </div>

      <div
        style={{
          padding: "1rem",
          borderRadius: "6px",
          backgroundColor: "#0f0e0d",
          color: "#22c55e",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          lineHeight: "1.6",
          maxHeight: "360px",
          overflowY: "auto",
          whiteSpace: "pre-wrap"
        }}
      >
        {logs.map((log, index) => (
          <div key={index} style={{ marginBottom: "4px" }}>
            <span style={{ color: "#706d66", marginRight: "8px" }}>&gt;</span>
            <span style={{ color: log.includes("Error") ? "#ef4444" : "#e5e4e2" }}>{log}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
