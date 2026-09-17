"use client";

import React, { useEffect } from "react";
import { TrustSelector, TrustPreset } from "../../../components/agents/TrustSelector";
import { CapabilityMultiSelect } from "../../../components/agents/CapabilityMultiSelect";
import { CapabilityItem } from "../../../lib/api";

interface StepTrustProps {
  preset: TrustPreset;
  onPresetChange: (preset: TrustPreset) => void;
  selectedCapabilities: string[];
  onCapabilitiesChange: (caps: string[]) => void;
  capabilities: CapabilityItem[];
  loadingCapabilities?: boolean;
}

export const StepTrust: React.FC<StepTrustProps> = ({
  preset,
  onPresetChange,
  selectedCapabilities,
  onCapabilitiesChange,
  capabilities,
  loadingCapabilities = false
}) => {
  // Whenever preset changes, synchronize capabilities automatically
  const handlePresetChange = (newPreset: TrustPreset) => {
    onPresetChange(newPreset);
    if (capabilities.length === 0) return;

    let matched: string[] = [];
    if (newPreset === "restricted") {
      matched = capabilities.filter((c) => c.tier === "read").map((c) => c.id);
    } else if (newPreset === "standard") {
      matched = capabilities.filter((c) => c.tier === "read" || c.tier === "mutate").map((c) => c.id);
    } else if (newPreset === "admin") {
      matched = capabilities.map((c) => c.id);
    }
    onCapabilitiesChange(matched);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Preset Selector */}
      <div>
        <h4 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
          1. Select Trust Preset
        </h4>
        <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", marginBottom: "1rem" }}>
          Governance fence defining the agent's baseline operational blast-radius and security gates.
        </p>

        <TrustSelector selectedPreset={preset} onChange={handlePresetChange} />
      </div>

      {/* 2. Fine-Grained Capability Multi-Select */}
      <div>
        <h4 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
          2. Fine-Grained Authorized Capabilities
        </h4>
        <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", marginBottom: "1rem" }}>
          Refine specific multi-cloud SDK operations exposed to this agent. Pre-selected by your trust preset.
        </p>

        <CapabilityMultiSelect
          capabilities={capabilities}
          selectedCapabilities={selectedCapabilities}
          onChange={onCapabilitiesChange}
          loading={loadingCapabilities}
        />
      </div>
    </div>
  );
};
