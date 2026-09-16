"use client";

import React, { useState } from "react";
import { useOperator } from "../../auth/OperatorContext";

export function TenantSwitcher() {
  const { session, availableTenants, switchTenant } = useOperator();
  const [open, setOpen] = useState(false);

  if (!session) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        className="tenant-pill"
        title="Active Organizational Tenant"
      >
        <span style={{ color: "#a8a29e" }}>Tenant:</span>
        <span style={{ fontWeight: 600, color: "#ffffff" }}>{session.tenantId}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "6px",
            backgroundColor: "#1c1a17",
            border: "1px solid #3e3b35",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--dropdown-shadow)",
            zIndex: 1100,
            minWidth: "260px",
            padding: "6px"
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: "11px", color: "#a8a29e", borderBottom: "1px solid #2e2c28", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Select Tenant Scope
          </div>
          {availableTenants.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                switchTenant(t.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                background: t.id === session.tenantId ? "#2a2723" : "transparent",
                color: "#ffffff",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: "2px"
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{t.name}</span>
                {t.id === session.tenantId && <span style={{ color: "#86efac", fontSize: "11px" }}>● Active</span>}
              </div>
              <div style={{ fontSize: "11px", color: "#a8a29e", fontFamily: "var(--font-mono)" }}>
                {t.id} ({t.environment})
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
