"use client";

import React, { useState, useEffect } from "react";
import { useOperator } from "../../../../auth/OperatorContext";

interface ActivityTabProps {
  agentId: string;
}

interface AuditEvent {
  id: string;
  eventType: string;
  action: string;
  verdict: string;
  traceparent?: string;
  timestamp: string;
  riskLevel?: string;
}

export const ActivityTab: React.FC<ActivityTabProps> = ({ agentId }) => {
  const { session } = useOperator();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Generate simulated audit events correlated to agentId
    setLoading(true);
    setTimeout(() => {
      const traceId = `4bf92f3577b34da6a3ce929d0e0e4736`;
      setEvents([
        {
          id: `ev_01`,
          eventType: "CAPABILITY_INVOKED",
          action: "aws.ecs.describe_clusters",
          verdict: "ALLOW",
          traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
          timestamp: new Date(Date.now() - 120000).toISOString(),
          riskLevel: "LOW"
        },
        {
          id: `ev_02`,
          eventType: "CAPABILITY_INVOKED",
          action: "aws.cloudwatch.get_metric_data",
          verdict: "ALLOW",
          traceparent: `00-${traceId}-5c28a8d11c437142-01`,
          timestamp: new Date(Date.now() - 340000).toISOString(),
          riskLevel: "LOW"
        },
        {
          id: `ev_03`,
          eventType: "CAPABILITY_APPROVAL_REQUIRED",
          action: "aws.ecs.update_service",
          verdict: "APPROVAL_REQUIRED",
          traceparent: `00-${traceId}-7d91e3fa02bc4501-01`,
          timestamp: new Date(Date.now() - 850000).toISOString(),
          riskLevel: "HIGH"
        },
        {
          id: `ev_04`,
          eventType: "GATEWAY_AUTH_SUCCESS",
          action: "BOOTSTRAP_HANDSHAKE",
          verdict: "CONNECTED",
          traceparent: `00-${traceId}-9a1024bc63ee1290-01`,
          timestamp: new Date(Date.now() - 1400000).toISOString(),
          riskLevel: "LOW"
        }
      ]);
      setLoading(false);
    }, 200);
  }, [agentId]);

  return (
    <div
      style={{
        padding: "1.5rem",
        backgroundColor: "var(--pure-white)",
        borderRadius: "8px",
        border: "1px solid var(--border-subtle)"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h4 style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)" }}>
          Correlated Audit Activity
        </h4>
        <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
          W3C Traceparent &amp; v7 Correlated Envelopes
        </span>
      </div>

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted-gray)", fontSize: "13px" }}>
          Loading audit events...
        </div>
      ) : events.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted-gray)", fontSize: "13px" }}>
          No recent activity recorded for this agent.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {events.map((ev) => (
            <div
              key={ev.id}
              style={{
                padding: "12px 14px",
                borderRadius: "6px",
                backgroundColor: "#fafaf9",
                border: "1px solid #f2f1ef",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "1rem"
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "13px", color: "var(--near-black-ink)" }}>{ev.action}</strong>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: "3px",
                      backgroundColor: ev.verdict === "ALLOW" || ev.verdict === "CONNECTED" ? "#ecfdf5" : "#fef3c7",
                      color: ev.verdict === "ALLOW" || ev.verdict === "CONNECTED" ? "#065f46" : "#92400e"
                    }}
                  >
                    {ev.verdict}
                  </span>
                </div>

                <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--muted-gray)" }}>
                  Trace: {ev.traceparent}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: "11px", color: "var(--muted-gray)", whiteSpace: "nowrap" }}>
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ display: "block", fontSize: "10px", color: "var(--muted-gray)" }}>
                  {ev.eventType}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
