"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";

interface Incident {
  id: string;
  provider: string;
  accountId: string;
  region: string;
  service: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "OPEN" | "INVESTIGATING" | "IDENTIFIED" | "REMEDIATING" | "RESOLVED";
  title: string;
  alertDescription: string;
  createdAt: string;
  investigationStatus?: string;
}

interface LiveStep {
  step: number;
  toolName: string;
  status: "pending" | "running" | "completed";
  observation?: string;
  evidenceId?: string;
}

interface RootCause {
  finding: string;
  rootCause: string;
  confidence: number;
  evidenceIds: string[];
  affectedResources: string[];
  recommendedRemediation?: {
    toolName: string;
    riskLevel: string;
    requiresApproval: boolean;
    parameters?: Record<string, unknown>;
  };
}

export default function InvestigatePage() {
  const { setChatContext, openChat } = useAgentChat();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [rootCause, setRootCause] = useState<RootCause | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [highlightedEvidenceId, setHighlightedEvidenceId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 1. Fetch real incidents from PostgreSQL API
  const loadIncidents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:3000/v1/incidents", {
        headers: { "x-tenant-id": "ten_default_tenant" }
      });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        setIncidents(items);
        if (items.length > 0 && !selectedIncidentId) {
          setSelectedIncidentId(items[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load incidents", err);
    } finally {
      setLoading(false);
    }
  }, [selectedIncidentId]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    if (selectedIncidentId) {
      setChatContext({
        investigationId: selectedIncidentId,
        service: "starvision-motors",
        sourcePage: "Investigations"
      });
    }
  }, [selectedIncidentId, setChatContext]);

  // 2. Trigger real controlled failure simulation and live Hermes investigation
  const handleSimulateAndInvestigate = async (serviceName = "starvision-motors", cluster = "cloudops-test", region = "us-east-1") => {
    setIsInvestigating(true);
    setLiveSteps([]);
    setRootCause(null);
    setPendingApprovalId(null);

    try {
      const res = await fetch("http://localhost:3000/v1/incidents/simulate-failure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "ten_default_tenant"
        },
        body: JSON.stringify({ service: serviceName, cluster, region })
      });

      if (res.ok) {
        const data = await res.json();
        const incident = data.incident;
        const investigation = data.investigation;
        const session = data.session;

        // Prepend new incident to state
        setIncidents((prev) => [incident, ...prev.filter((i) => i.id !== incident.id)]);
        setSelectedIncidentId(incident.id);
        setActiveSessionId(session.sessionId);

        // Connect to live Server-Sent Events stream
        subscribeToLiveStream(investigation.id, session.sessionId);
      } else {
        setIsInvestigating(false);
      }
    } catch (err) {
      console.error("Failed to simulate failure", err);
      setIsInvestigating(false);
    }
  };

  // 3. Start investigation for existing incident
  const handleStartInvestigation = async () => {
    if (!selectedIncidentId) return;
    setIsInvestigating(true);
    setLiveSteps([]);
    setRootCause(null);
    setPendingApprovalId(null);

    try {
      const res = await fetch("http://localhost:3000/v1/investigations/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": "ten_default_tenant"
        },
        body: JSON.stringify({ incidentId: selectedIncidentId })
      });

      if (res.ok) {
        const data = await res.json();
        setIncidents((prev) =>
          prev.map((inc) =>
            inc.id === selectedIncidentId
              ? { ...inc, status: "INVESTIGATING", investigationStatus: "INVESTIGATING" }
              : inc
          )
        );
        setActiveSessionId(data.sessionId);
        subscribeToLiveStream(data.investigationId, data.sessionId);
      } else {
        setIsInvestigating(false);
      }
    } catch (err) {
      console.error("Failed to start investigation", err);
      setIsInvestigating(false);
    }
  };

  // 4. Live Server-Sent Events (SSE) Stream Subscription
  const subscribeToLiveStream = (investigationId: string, sessionId: string) => {
    const sse = new EventSource(
      `http://localhost:3000/v1/investigations/${investigationId}/stream?sessionId=${sessionId}`
    );

    sse.addEventListener("step", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const stepNum = parsed.data.step;
        const toolName = parsed.data.toolName;
        setLiveSteps((prev) => {
          const exists = prev.find((s) => s.step === stepNum);
          if (exists) {
            return prev.map((s) => (s.step === stepNum ? { ...s, toolName, status: "running" } : s));
          }
          return [...prev, { step: stepNum, toolName, status: "running" }];
        });
      } catch (err) {
        console.error("Error parsing step SSE", err);
      }
    });

    sse.addEventListener("observation", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const stepNum = parsed.data.step;
        setLiveSteps((prev) =>
          prev.map((s) =>
            s.step === stepNum
              ? { ...s, status: "completed", observation: parsed.data.observation }
              : s
          )
        );
      } catch (err) {
        console.error("Error parsing observation SSE", err);
      }
    });

    sse.addEventListener("evidence", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const evData = parsed.data;
        setLiveSteps((prev) => {
          // If latest running step has no evidence, attach to it
          const runningIdx = prev.findLastIndex((s) => s.status === "running");
          if (runningIdx >= 0) {
            return prev.map((s, idx) =>
              idx === runningIdx
                ? {
                    ...s,
                    status: "completed",
                    evidenceId: evData.evidenceId,
                    observation: evData.observation
                  }
                : s
            );
          }
          return [
            ...prev,
            {
              step: prev.length + 1,
              toolName: evData.source || "AWS_INSPECTION",
              status: "completed",
              evidenceId: evData.evidenceId,
              observation: evData.observation
            }
          ];
        });
      } catch (err) {
        console.error("Error parsing evidence SSE", err);
      }
    });

    sse.addEventListener("root_cause", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setRootCause(parsed.data);
        setIsInvestigating(false);
      } catch (err) {
        console.error("Error parsing root_cause SSE", err);
      }
    });

    sse.addEventListener("proposal", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.data?.remediation?.parameters) {
          setPendingApprovalId(parsed.data.approvalId || "pending");
        }
      } catch (err) {
        console.error("Error parsing proposal SSE", err);
      }
    });

    sse.addEventListener("error", () => {
      setIsInvestigating(false);
      sse.close();
    });
  };

  const selectedIncident = incidents.find((i) => i.id === selectedIncidentId);

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
              Autonomous SRE Diagnostics
            </span>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "#16a34a",
                background: "#ecfdf5",
                border: "1px solid #bbf7d0",
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
                textTransform: "uppercase"
              }}
            >
              Agent: cloud-hermes · Live
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Investigations & Diagnostics
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Live agent activity, real AWS telemetry correlation, and cryptographically governed root-cause analysis.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => handleSimulateAndInvestigate("starvision-motors", "cloudops-test", "us-east-1")}
            disabled={isInvestigating}
            className="btn-primary"
            style={{ fontSize: "13px", background: "#b91c1c", borderColor: "#991b1b" }}
          >
            {isInvestigating ? "Investigating Real Workload..." : "🔥 Trigger Failure & Run Hermes SRE"}
          </button>

          {selectedIncident && (
            <button
              type="button"
              onClick={handleStartInvestigation}
              disabled={isInvestigating}
              className="btn-secondary"
              style={{ fontSize: "13px" }}
            >
              ▶ Re-investigate Selected
            </button>
          )}
        </div>
      </div>

      {/* 2. Incidents List Table */}
      <div className="harvey-card" style={{ padding: "0" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--warm-gray-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
            Cloud Incidents in PostgreSQL
          </div>
          <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)" }}>
            Showing <strong>{incidents.length}</strong> logged incidents
          </div>
        </div>

        {incidents.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#faf9f7", borderBottom: "1px solid var(--warm-gray-border)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Severity</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Incident ID</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Workload / Service</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Region</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Logged At</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr
                    key={inc.id}
                    onClick={() => setSelectedIncidentId(inc.id)}
                    style={{
                      cursor: "pointer",
                      borderBottom: "1px solid var(--warm-gray-border)",
                      backgroundColor: selectedIncidentId === inc.id ? "#f5f4f0" : "transparent"
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <span className={`status-pill ${inc.severity.toLowerCase()}`}>
                        {inc.severity}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                      {inc.id}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>
                      {inc.service}
                    </td>
                    <td style={{ padding: "12px 16px" }}>{inc.provider}</td>
                    <td style={{ padding: "12px 16px" }}>{inc.region}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="status-pill active">{inc.status}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--mid-warm-gray)", fontSize: "12px" }}>
                      {new Date(inc.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "36px 20px", textAlign: "center" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "6px" }}>
              No Active Incidents Logged Yet
            </div>
            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", maxWidth: "560px", margin: "0 auto 16px" }}>
              The PostgreSQL incident database is clean. Click below to simulate a live container failure on real discovered workload <strong>starvision-motors</strong> (cloudops-test / us-east-1) and dispatch the live <strong>cloud-hermes</strong> autonomous agent.
            </p>
            <button
              type="button"
              onClick={() => handleSimulateAndInvestigate("starvision-motors", "cloudops-test", "us-east-1")}
              disabled={isInvestigating}
              className="btn-primary"
              style={{ fontSize: "13px" }}
            >
              🔥 Simulate Incident & Run Live Hermes Investigation
            </button>
          </div>
        )}
      </div>

      {/* 3. Operational Investigation Workspace */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "1.5rem" }}>
        {/* Left Column: Live Agent Activity Stream */}
        <div className="harvey-card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
              Live Agent Execution Stream
            </div>
            <span className="status-pill active" style={{ fontSize: "10.5px" }}>
              {isInvestigating ? "● Live SSE Connected" : "Stream Idle"}
            </span>
          </div>

          <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", marginBottom: "16px" }}>
            Real-time diagnostic steps executed by <strong>cloud-hermes</strong> via Server-Sent Events. Diagnostic observations are persisted to PostgreSQL <code>incident_evidence</code>.
          </p>

          {liveSteps.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {liveSteps.map((step) => {
                const isHighlighted = highlightedEvidenceId === step.evidenceId;
                return (
                  <div
                    key={step.step}
                    id={step.evidenceId}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: isHighlighted ? "2px solid #2563eb" : "1px solid var(--warm-gray-border)",
                      backgroundColor: isHighlighted ? "#eff6ff" : "#faf9f7",
                      transition: "all 0.2s ease"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", fontWeight: 600 }}>
                        <span style={{ color: step.status === "running" ? "#d97706" : "#16a34a" }}>
                          {step.status === "running" ? "⏳ Running Step " + step.step + ":" : "✓ Step " + step.step + ":"}
                        </span>
                        <code>{step.toolName}</code>
                      </div>
                      {step.evidenceId && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontFamily: "var(--font-mono)",
                            background: "#e5e7eb",
                            padding: "2px 6px",
                            borderRadius: "4px"
                          }}
                        >
                          {step.evidenceId}
                        </span>
                      )}
                    </div>
                    {step.observation && (
                      <div style={{ fontSize: "12px", color: "var(--near-black-ink)", marginTop: "4px" }}>
                        {step.observation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--mid-warm-gray)", fontSize: "13px" }}>
              {isInvestigating
                ? "Connecting to live agent session stream..."
                : "No investigation running. Click 'Trigger Failure & Run Hermes SRE' above to launch."}
            </div>
          )}
        </div>

        {/* Right Column: Root Cause & Linked Evidence View */}
        <div className="harvey-card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
              Root Cause & Evidence Links
            </div>
            {rootCause && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#16a34a",
                  background: "#ecfdf5",
                  border: "1px solid #bbf7d0",
                  padding: "2px 8px",
                  borderRadius: "12px"
                }}
              >
                Confidence: {Math.round(rootCause.confidence * 100)}%
              </span>
            )}
          </div>

          {rootCause ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Primary Finding Card */}
              <div style={{ padding: "16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#991b1b", textTransform: "uppercase", marginBottom: "4px" }}>
                  Root Cause Identified: {rootCause.finding}
                </div>
                <p style={{ fontSize: "13.5px", color: "#7f1d1d", margin: 0, lineHeight: 1.5 }}>
                  {rootCause.rootCause}
                </p>
              </div>

              {/* Supporting Evidence IDs */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--mid-warm-gray)", marginBottom: "8px" }}>
                  Supporting Evidence IDs
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {rootCause.evidenceIds.map((evId) => (
                    <button
                      key={evId}
                      type="button"
                      onClick={() => {
                        setHighlightedEvidenceId(evId);
                        const el = document.getElementById(evId);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        background: highlightedEvidenceId === evId ? "#2563eb" : "#ffffff",
                        color: highlightedEvidenceId === evId ? "#ffffff" : "#1d4ed8",
                        border: "1px solid #93c5fd",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      🔗 {evId}
                    </button>
                  ))}
                </div>
              </div>

              {/* Affected Resources */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--mid-warm-gray)", marginBottom: "8px" }}>
                  Affected Cloud Infrastructure
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {rootCause.affectedResources.map((arn) => (
                    <code
                      key={arn}
                      style={{
                        fontSize: "11px",
                        background: "#f3f4f6",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        wordBreak: "break-all"
                      }}
                    >
                      {arn}
                    </code>
                  ))}
                </div>
              </div>

              {/* Proposed Remediation & Link to Approvals */}
              {rootCause.recommendedRemediation && (
                <div style={{ padding: "16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#166534", textTransform: "uppercase", marginBottom: "4px" }}>
                    Proposed Remediation Hand-Off
                  </div>
                  <div style={{ fontSize: "13px", color: "#14532d", marginBottom: "12px" }}>
                    Action: <code>{rootCause.recommendedRemediation.toolName}</code> • Risk Level: <strong>{rootCause.recommendedRemediation.riskLevel}</strong> • Human Authorization: <strong>Required (Ed25519)</strong>
                  </div>
                  <Link
                    href="/approvals"
                    className="btn-primary"
                    style={{ fontSize: "12.5px", display: "inline-block", textDecoration: "none" }}
                  >
                    Authorize Remediation in Approvals Queue →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--mid-warm-gray)", fontSize: "13px" }}>
              No active root cause synthesis available. Launch an investigation to diagnose.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
