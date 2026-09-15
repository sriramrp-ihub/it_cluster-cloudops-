"use client";

import React from "react";
import Link from "next/link";
import { useOperator } from "../../auth/OperatorContext";

export default function SettingsPage() {
  const { session, availableTenants, availableOperators } = useOperator();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
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
            Configuration
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Tenant & Control Plane Settings
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Organization parameters, active operator persona context, and cryptographic gateway configurations.
        </p>
      </div>

      {/* Active Session Summary */}
      <div className="harvey-card">
        <h3 className="panel-title" style={{ marginBottom: "16px" }}>
          Active Operator Session Dossier
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", fontSize: "13.5px" }}>
          <div style={{ padding: "12px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Operator Name</div>
            <div style={{ fontWeight: 600, marginTop: "2px" }}>{session?.operatorName}</div>
            <div style={{ fontSize: "11px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
              ID: {session?.operatorId}
            </div>
          </div>

          <div style={{ padding: "12px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Operator Role</div>
            <div style={{ fontWeight: 600, textTransform: "capitalize", marginTop: "2px" }}>
              {session?.operatorRole?.replace("_", " ")}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted-gray)" }}>
              Full Control Plane Authority
            </div>
          </div>

          <div style={{ padding: "12px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Active Tenant Scope</div>
            <div style={{ fontWeight: 600, marginTop: "2px" }}>{session?.tenantName}</div>
            <div style={{ fontSize: "11px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
              {session?.tenantId}
            </div>
          </div>

          <div style={{ padding: "12px", background: "#f7f6f4", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Session Expiry</div>
            <div style={{ fontWeight: 600, marginTop: "2px" }}>
              {session?.expiresAt ? new Date(session.expiresAt).toLocaleTimeString() : "N/A"}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted-gray)" }}>
              8-Hour Operational Window
            </div>
          </div>
        </div>
      </div>

      {/* Registered Tenants Directory */}
      <div className="harvey-card">
        <h3 className="panel-title" style={{ marginBottom: "12px" }}>
          Registered Organizational Tenants
        </h3>
        <p className="body-subtle" style={{ marginBottom: "16px" }}>
          Tenants provisioned in PostgreSQL table <code className="code-inline">tenants</code> providing relational database-level isolation.
        </p>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tenant ID</th>
                <th>Organization Name</th>
                <th>Environment Profile</th>
                <th>Isolation Mode</th>
              </tr>
            </thead>
            <tbody>
              {availableTenants.map((t) => (
                <tr key={t.id}>
                  <td><span className="code-inline">{t.id}</span></td>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td>{t.environment}</td>
                  <td><span className="status-pill connected">ROW ISOLATED</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Control Plane Parameters */}
      <div className="harvey-card">
        <h3 className="panel-title" style={{ marginBottom: "12px" }}>
          Gateway & Security Parameters
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13.5px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ color: "var(--mid-warm-gray)" }}>WebSocket Port:</span>
            <span className="code-inline">3000 (/v1/gateway/ws)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ color: "var(--mid-warm-gray)" }}>Heartbeat Timeout Threshold:</span>
            <span>90,000 ms</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <span style={{ color: "var(--mid-warm-gray)" }}>Bootstrap Token Exchange:</span>
            <span style={{ color: "#16a34a", fontWeight: 500 }}>Single-Use (Atomic Consumption)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
            <span style={{ color: "var(--mid-warm-gray)" }}>Secret Storage:</span>
            <span>CSPRNG Salted SHA-256 Hashing Only</span>
          </div>
        </div>
      </div>
    </div>
  );
}
