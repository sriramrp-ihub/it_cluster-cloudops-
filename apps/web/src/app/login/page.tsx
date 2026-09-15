"use client";

import React, { useState } from "react";
import { useOperator } from "../../auth/OperatorContext";

export default function LoginPage() {
  const { availableTenants, availableOperators, login, isLoading } = useOperator();

  const [selectedOperator, setSelectedOperator] = useState("op_admin_operator");
  const [selectedTenant, setSelectedTenant] = useState("ten_default_tenant");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(selectedOperator, selectedTenant);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: "480px", margin: "40px auto", padding: "0 16px" }}>
      <div className="harvey-card" style={{ padding: "36px 32px" }}>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              background: "var(--near-black-ink)",
              color: "#ffffff",
              borderRadius: "var(--radius-sm)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "18px",
              marginBottom: "16px"
            }}
          >
            CO
          </div>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "30px",
              fontWeight: 400,
              color: "var(--near-black-ink)",
              marginBottom: "8px",
              lineHeight: 1.15
            }}
          >
            Authenticate Operator Session
          </h1>
          <p className="body-subtle" style={{ fontSize: "14px", color: "var(--mid-warm-gray)" }}>
            Enter the CloudOps autonomous operations control plane. Select an operator persona and target organizational tenant scope.
          </p>
        </div>

        {error && (
          <div className="alert-banner error" style={{ marginBottom: "20px" }}>
            <div style={{ fontWeight: 600 }}>Error:</div>
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="form-group">
            <label className="form-label">Operator Persona</label>
            <select
              value={selectedOperator}
              onChange={(e) => setSelectedOperator(e.target.value)}
              className="form-input"
              style={{ padding: "9px 12px" }}
            >
              {availableOperators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.name} — {op.role.replace("_", " ")}
                </option>
              ))}
            </select>
            <div style={{ fontSize: "11px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
              Identity ID: {selectedOperator}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Organizational Tenant Scope</label>
            <select
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              className="form-input"
              style={{ padding: "9px 12px" }}
            >
              {availableTenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.environment})
                </option>
              ))}
            </select>
            <div style={{ fontSize: "11px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
              Tenant ID: {selectedTenant}
            </div>
          </div>

          <div
            style={{
              padding: "12px 14px",
              background: "#f7f6f4",
              border: "1px solid var(--warm-gray-border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "12px",
              color: "var(--mid-warm-gray)",
              display: "flex",
              justifyContent: "space-between"
            }}
          >
            <span>Session Validity:</span>
            <span style={{ fontWeight: 600, color: "var(--near-black-ink)" }}>8 Hours (Shift TTL)</span>
          </div>

          <button
            type="submit"
            disabled={submitting || isLoading}
            className="btn-primary"
            style={{ width: "100%", padding: "10px", fontSize: "15px" }}
          >
            {submitting ? "Authenticating Operator..." : "Authenticate & Enter Control Plane →"}
          </button>
        </form>

        <div
          style={{
            marginTop: "24px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border-subtle)",
            fontSize: "12px",
            color: "var(--muted-gray)",
            textAlign: "center",
            fontFamily: "var(--font-mono)"
          }}
        >
          Cryptographic Invariant: APPROVED ≠ CONNECTED
        </div>
      </div>
    </div>
  );
}
