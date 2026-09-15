"use client";

import React, { useState } from "react";
import { useOperator } from "../../auth/OperatorContext";

export function OperatorBadge() {
  const { session, logout } = useOperator();
  const [open, setOpen] = useState(false);

  if (!session) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "transparent",
          border: "1px solid #33312c",
          borderRadius: "var(--radius-sm)",
          padding: "4px 10px",
          color: "#ffffff",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}
      >
        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#60a5fa" }} />
        <span>{session.operatorName}</span>
        <span style={{ fontSize: "10px", color: "#a8a29e" }}>▼</span>
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
            minWidth: "240px",
            padding: "8px"
          }}
        >
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #2e2c28", marginBottom: "6px" }}>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#ffffff" }}>{session.operatorName}</div>
            <div style={{ fontSize: "11px", color: "#a8a29e", fontFamily: "var(--font-mono)" }}>
              ID: {session.operatorId}
            </div>
            <div style={{ fontSize: "11px", color: "#60a5fa", textTransform: "capitalize", marginTop: "2px" }}>
              Role: {session.operatorRole.replace("_", " ")}
            </div>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            style={{
              width: "100%",
              padding: "7px 10px",
              background: "#2e1a1a",
              color: "#fca5a5",
              border: "1px solid #5c2626",
              borderRadius: "var(--radius-sm)",
              fontSize: "12px",
              cursor: "pointer",
              textAlign: "left"
            }}
          >
            Sign Out of Control Plane
          </button>
        </div>
      )}
    </div>
  );
}
