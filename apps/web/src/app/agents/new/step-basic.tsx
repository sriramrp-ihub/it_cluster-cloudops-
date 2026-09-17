"use client";

import React from "react";
import { AgentBasicFormValues } from "../../../lib/validation";

interface StepBasicProps {
  values: AgentBasicFormValues;
  onChange: (values: AgentBasicFormValues) => void;
  errors?: Record<string, string>;
}

export const StepBasic: React.FC<StepBasicProps> = ({ values, onChange, errors }) => {
  const agentTypes: { id: "hermes" | "openclaw" | "custom"; label: string; desc: string; badge: string }[] = [
    {
      id: "hermes",
      label: "Hermes AI Agent",
      desc: "Autonomous SRE agent powered by Hermes LLM and Paperclip orchestration engine.",
      badge: "RECOMMENDED"
    },
    {
      id: "openclaw",
      label: "OpenClaw Sidecar",
      desc: "Standard OpenClaw runtime connecting via WebSocket tool-call bridge.",
      badge: "SIDECAR"
    },
    {
      id: "custom",
      label: "Custom ACP Agent",
      desc: "Generic agent adapter implementing the Agent Communication Protocol (ACP).",
      badge: "CUSTOM"
    }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Agent Name */}
      <div>
        <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)", display: "block", marginBottom: "4px" }}>
          Agent Name *
        </label>
        <input
          type="text"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder="e.g. production-sre-hermes"
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: "4px",
            border: errors?.name ? "1px solid #dc2626" : "1px solid var(--warm-gray-border)",
            fontSize: "14px",
            backgroundColor: "var(--pure-white)"
          }}
        />
        {errors?.name ? (
          <span style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px", display: "block" }}>{errors.name}</span>
        ) : (
          <span style={{ fontSize: "12px", color: "var(--muted-gray)", marginTop: "4px", display: "block" }}>
            A unique descriptive name for your autonomous operations agent.
          </span>
        )}
      </div>

      {/* 2. Agent Type Selection */}
      <div>
        <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)", display: "block", marginBottom: "8px" }}>
          Agent Type *
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          {agentTypes.map((type) => {
            const isSelected = values.type === type.id;
            return (
              <div
                key={type.id}
                onClick={() => onChange({ ...values, type: type.id })}
                style={{
                  padding: "1.25rem",
                  borderRadius: "8px",
                  border: isSelected ? "2px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                  backgroundColor: isSelected ? "var(--pure-white)" : "#fafaf9",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: isSelected ? "0 4px 12px rgba(15, 14, 13, 0.08)" : "none"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600, fontSize: "15px", color: "var(--near-black-ink)" }}>
                    {type.label}
                  </span>
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      padding: "2px 5px",
                      borderRadius: "3px",
                      backgroundColor: type.id === "hermes" ? "#e0f2fe" : "#f2f1ef",
                      color: type.id === "hermes" ? "#0369a1" : "var(--mid-warm-gray)"
                    }}
                  >
                    {type.badge}
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--mid-warm-gray)", lineHeight: "1.4" }}>
                  {type.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Description (Optional) */}
      <div>
        <label style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)", display: "block", marginBottom: "4px" }}>
          Description <span style={{ fontWeight: 400, color: "var(--muted-gray)" }}>(Optional)</span>
        </label>
        <textarea
          value={values.description || ""}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          rows={3}
          placeholder="e.g. Handles ECS crashloop diagnostics, CloudWatch alarms, and rollback orchestration for us-east-1 production workloads."
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: "4px",
            border: "1px solid var(--warm-gray-border)",
            fontSize: "14px",
            backgroundColor: "var(--pure-white)"
          }}
        />
      </div>
    </div>
  );
};
