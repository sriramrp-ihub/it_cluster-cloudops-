"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { fetchAgents, AgentItem } from "../../../lib/api";
import { useOperator } from "../../../auth/OperatorContext";

interface FrameLog {
  id: string;
  direction: "IN" | "OUT";
  timestamp: string;
  payload: Record<string, unknown>;
}

export default function AgentDiagnosticsPage() {
  const { session } = useOperator();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);

  // WebSocket interactive test harness state
  const [wsConnected, setWsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [runtimeSecret, setRuntimeSecret] = useState<string>("");
  const [frameLogs, setFrameLogs] = useState<FrameLog[]>([]);
  const [authCredentialInput, setAuthCredentialInput] = useState("");
  const [authTypeInput, setAuthTypeInput] = useState<"BOOTSTRAP" | "RUNTIME">("BOOTSTRAP");

  const wsRef = useRef<WebSocket | null>(null);
  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  async function loadAgents() {
    setLoading(true);
    try {
      const items = await fetchAgents(tenantId, operatorId);
      setAgents(items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, [tenantId]);

  function addFrameLog(direction: "IN" | "OUT", payload: Record<string, unknown>) {
    setFrameLogs((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        direction,
        timestamp: new Date().toLocaleTimeString(),
        payload
      },
      ...prev.slice(0, 40)
    ]);
  }

  function handleConnectWs() {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket("ws://localhost:3000/v1/gateway/ws");
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      addFrameLog("IN", { status: "WS_SOCKET_OPENED", target: "ws://localhost:3000/v1/gateway/ws" });
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        addFrameLog("IN", data);

        if (data.type === "AUTH_SUCCESS") {
          setSessionId(data.sessionId);
          if (data.runtimeCredential?.secret) {
            setRuntimeSecret(data.runtimeCredential.secret);
          }
          loadAgents();
        } else if (data.type === "CREDENTIAL_ROTATED") {
          setRuntimeSecret(data.newRuntimeCredential.secret);
        }
      } catch {
        addFrameLog("IN", { raw: evt.data });
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      addFrameLog("IN", { status: "WS_SOCKET_CLOSED" });
      loadAgents();
    };

    ws.onerror = () => {
      addFrameLog("IN", { error: "WebSocket connection error" });
    };
  }

  function handleDisconnectWs() {
    if (wsRef.current) {
      if (sessionId) {
        const frame = { type: "DISCONNECT", sessionId, reason: "Operator manual disconnect" };
        wsRef.current.send(JSON.stringify(frame));
        addFrameLog("OUT", frame);
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    setSessionId("");
  }

  function handleSendAuth() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addFrameLog("OUT", { error: "Socket not open. Connect first." });
      return;
    }

    const frame = {
      type: "AUTH",
      authType: authTypeInput,
      credential: authCredentialInput || (authTypeInput === "RUNTIME" && runtimeSecret ? runtimeSecret : "co_agent_mock_test_token"),
      runtimeInfo: {
        name: "diagnostics-console-harness",
        version: "1.0.0",
        protocol: "acp"
      }
    };

    wsRef.current.send(JSON.stringify(frame));
    addFrameLog("OUT", frame);
  }

  function handleSendHeartbeat() {
    if (!wsRef.current || !sessionId) return;
    const frame = { type: "HEARTBEAT", sessionId, timestamp: Date.now() };
    wsRef.current.send(JSON.stringify(frame));
    addFrameLog("OUT", frame);
  }

  function handleSendRotate() {
    if (!wsRef.current || !sessionId) return;
    const frame = { type: "ROTATE_CREDENTIAL", sessionId };
    wsRef.current.send(JSON.stringify(frame));
    addFrameLog("OUT", frame);
  }

  const connectedAgents = agents.filter((a) => a.status === "CONNECTED");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Subnav Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", borderBottom: "1px solid var(--warm-gray-border)", paddingBottom: "12px" }}>
        <Link href="/agents" style={{ fontSize: "14px", color: "var(--mid-warm-gray)", textDecoration: "none", fontWeight: 500 }}>
          Fleet Directory
        </Link>
        <Link href="/agents/add" style={{ fontSize: "14px", color: "var(--mid-warm-gray)", textDecoration: "none", fontWeight: 500 }}>
          + Add Agent
        </Link>
        <Link href="/agents/join-requests" style={{ fontSize: "14px", color: "var(--mid-warm-gray)", textDecoration: "none", fontWeight: 500 }}>
          Join Requests
        </Link>
        <span style={{ fontSize: "14px", color: "var(--near-black-ink)", fontWeight: 600, borderBottom: "2px solid var(--near-black-ink)", paddingBottom: "12px", marginBottom: "-13px" }}>
          Diagnostics
        </span>
      </div>

      {/* Header */}
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
            Secondary Diagnostic View
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Gateway & Protocol Diagnostics
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Underlying WebSocket control plane diagnostics. Inspect live JSON protocol frames, session keys, and socket health for agent troubleshooting.
        </p>
      </div>

      {/* Gateway Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
        <div className="harvey-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontWeight: 600 }}>
            Gateway Socket Endpoint
          </div>
          <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
            WebSocket Listening
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
            ws://localhost:3000/v1/gateway/ws
          </div>
        </div>

        <div className="harvey-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontWeight: 600 }}>
            Live Fleet Sessions
          </div>
          <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
            {connectedAgents.length} Active Sessions
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted-gray)", marginTop: "2px" }}>
            {agents.length} Total Registered
          </div>
        </div>

        <div className="harvey-card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontWeight: 600 }}>
            Heartbeat Liveness Policy
          </div>
          <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
            30s Interval
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted-gray)", marginTop: "2px" }}>
            90s Stale Session Eviction
          </div>
        </div>
      </div>

      {/* Two Column Console: Live Inspector & Active Sessions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "1.5rem" }}>
        {/* Left Column: Interactive WebSocket Frame Harness */}
        <div className="harvey-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 className="panel-title">Interactive WebSocket Frame Tester</h3>
            <span className={`status-pill ${wsConnected ? "connected" : "offline"}`}>
              <span className="status-dot-inner" />
              {wsConnected ? "SOCKET OPEN" : "DISCONNECTED"}
            </span>
          </div>
          <p className="body-subtle" style={{ marginBottom: "16px" }}>
            Direct browser socket to test handshake frames (<code className="code-inline">AUTH</code>, <code className="code-inline">HEARTBEAT</code>, <code className="code-inline">ROTATE_CREDENTIAL</code>).
          </p>

          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            {!wsConnected ? (
              <button onClick={handleConnectWs} className="btn-primary" style={{ fontSize: "13px" }}>
                Open WebSocket Connection
              </button>
            ) : (
              <button onClick={handleDisconnectWs} className="btn-danger" style={{ fontSize: "13px" }}>
                Close Connection
              </button>
            )}
          </div>

          {wsConnected && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", marginBottom: "16px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={authTypeInput}
                  onChange={(e) => setAuthTypeInput(e.target.value as any)}
                  className="form-input"
                  style={{ width: "140px", fontSize: "12px" }}
                >
                  <option value="BOOTSTRAP">BOOTSTRAP</option>
                  <option value="RUNTIME">RUNTIME</option>
                </select>
                <input
                  type="text"
                  placeholder={authTypeInput === "BOOTSTRAP" ? "co_agent_<64hex>" : "cred_<64hex>"}
                  value={authCredentialInput}
                  onChange={(e) => setAuthCredentialInput(e.target.value)}
                  className="form-input mono"
                  style={{ flex: 1, fontSize: "12px" }}
                />
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button onClick={handleSendAuth} className="btn-secondary" style={{ fontSize: "12px", padding: "4px 10px" }}>
                  Send AUTH Frame
                </button>
                <button
                  onClick={handleSendHeartbeat}
                  disabled={!sessionId}
                  className="btn-secondary"
                  style={{ fontSize: "12px", padding: "4px 10px" }}
                >
                  Send HEARTBEAT
                </button>
                <button
                  onClick={handleSendRotate}
                  disabled={!sessionId}
                  className="btn-secondary"
                  style={{ fontSize: "12px", padding: "4px 10px" }}
                >
                  ROTATE_CREDENTIAL
                </button>
              </div>

              {sessionId && (
                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--mid-warm-gray)" }}>
                  Active Session ID: <strong style={{ color: "var(--near-black-ink)" }}>{sessionId}</strong>
                </div>
              )}
            </div>
          )}

          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--mid-warm-gray)", marginBottom: "6px" }}>
              Live Protocol Frame Log
            </div>
            <div className="code-container" style={{ maxHeight: "240px", overflowY: "auto", fontSize: "11.5px" }}>
              {frameLogs.length === 0 ? (
                <div style={{ color: "var(--muted-gray)" }}>No frames recorded yet. Open socket and send an AUTH frame.</div>
              ) : (
                frameLogs.map((log) => (
                  <div key={log.id} style={{ marginBottom: "6px", borderBottom: "1px solid #2e2c28", paddingBottom: "4px" }}>
                    <span style={{ color: log.direction === "OUT" ? "#93c5fd" : "#86efac", fontWeight: 600 }}>
                      [{log.direction}] {log.timestamp}:
                    </span>{" "}
                    <span>{JSON.stringify(log.payload)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Connected Agents List */}
        <div className="harvey-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 className="panel-title">Active Gateway Sessions</h3>
            <button onClick={loadAgents} className="btn-secondary" style={{ fontSize: "11px", padding: "3px 8px" }}>
              ↻ Refresh
            </button>
          </div>
          <p className="body-subtle" style={{ marginBottom: "16px" }}>
            Agents currently holding verified live sessions in PostgreSQL table <code className="code-inline">agent_sessions</code>.
          </p>

          {connectedAgents.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", border: "1px dashed var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
              <div style={{ fontWeight: 500, fontSize: "14px", color: "var(--near-black-ink)", marginBottom: "4px" }}>
                No Active Sessions
              </div>
              <p className="body-subtle" style={{ fontSize: "13px" }}>
                All registered agents are currently offline. Connect an agent runtime daemon to establish a session.
              </p>
            </div>
          ) : (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Runtime</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {connectedAgents.map((ag) => (
                    <tr key={ag.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{ag.name}</div>
                        <div className="code-inline" style={{ fontSize: "11px" }}>{ag.id}</div>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                        {ag.type} ({ag.runtimeProtocol})
                      </td>
                      <td>
                        <span className="status-pill connected">
                          <span className="status-dot-inner" />
                          CONNECTED
                        </span>
                      </td>
                      <td>
                        <Link href={`/agents/${ag.id}`} className="btn-secondary" style={{ fontSize: "11px", padding: "3px 8px" }}>
                          Inspect Dossier
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
