"use client";

import React from "react";

export type TrustPreset = "standard" | "restricted" | "admin";

interface TrustSelectorProps {
  selectedPreset: TrustPreset;
  onChange: (preset: TrustPreset) => void;
}

export const PRESET_DESCRIPTIONS: Record<TrustPreset, { title: string; subtitle: string; tag: string; tagBg: string; tagColor: string; tiers: string[] }> = {
  standard: {
    title: "Standard",
    subtitle: "Company-visible collaboration. Default for normal operational SRE work.",
    tag: "RECOMMENDED",
    tagBg: "#e0f2fe",
    tagColor: "#0369a1",
    tiers: ["Read (Inspection)", "Mutate (Governed Approval)"]
  },
  restricted: {
    title: "Restricted",
    subtitle: "Read-only access. Strictly no mutations, no task scaling, and no deployments.",
    tag: "ISOLATED",
    tagBg: "#fef3c7",
    tagColor: "#92400e",
    tiers: ["Read Only"]
  },
  admin: {
    title: "Admin",
    subtitle: "Full multi-cloud access including deployment capabilities and emergency bypass.",
    tag: "PRIVILEGED",
    tagBg: "#fee2e2",
    tagColor: "#991b1b",
    tiers: ["Read", "Mutate", "Deploy (Resource Creation)"]
  }
};

export const TrustSelector: React.FC<TrustSelectorProps> = ({ selectedPreset, onChange }) => {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
      {(["standard", "restricted", "admin"] as TrustPreset[]).map((preset) => {
        const info = PRESET_DESCRIPTIONS[preset];
        const isSelected = selectedPreset === preset;

        return (
          <div
            key={preset}
            onClick={() => onChange(preset)}
            style={{
              padding: "1.25rem",
              borderRadius: "8px",
              border: isSelected ? "2px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
              backgroundColor: isSelected ? "var(--pure-white)" : "#fafaf9",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: isSelected ? "0 4px 12px rgba(15, 14, 13, 0.08)" : "none",
              position: "relative"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "16px", color: "var(--near-black-ink)" }}>{info.title}</span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: info.tagBg,
                  color: info.tagColor
                }}
              >
                {info.tag}
              </span>
            </div>

            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: "1.45", marginBottom: "1rem" }}>
              {info.subtitle}
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {info.tiers.map((tier) => (
                <span
                  key={tier}
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    backgroundColor: "#f2f1ef",
                    color: "var(--dark-warm-gray)",
                    padding: "2px 6px",
                    borderRadius: "4px"
                  }}
                >
                  {tier}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
