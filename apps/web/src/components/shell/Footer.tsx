import React from "react";

export function Footer() {
  return (
    <footer className="app-footer">
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, color: "var(--near-black-ink)" }}>CloudOps Control Plane v0.1.0</span>
        <span>•</span>
        <span>Phase 3 Gateway Active</span>
        <span>•</span>
        <span style={{ color: "#16a34a", fontWeight: 500 }}>PostgreSQL 16 Connected</span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
        Invariant Rule: <strong>APPROVED ≠ CONNECTED</strong>
      </div>
    </footer>
  );
}
