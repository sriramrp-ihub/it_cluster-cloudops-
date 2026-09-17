"use client";

import React from "react";
import { AdapterConfig } from "../../../components/agents/AdapterConfig";
import {
  HermesAdapterFormValues,
  OpenClawAdapterFormValues,
  CustomAdapterFormValues
} from "../../../lib/validation";

interface StepAdapterProps {
  agentType: "hermes" | "openclaw" | "custom";
  hermesConfig: HermesAdapterFormValues;
  onHermesChange: (config: HermesAdapterFormValues) => void;
  openclawConfig: OpenClawAdapterFormValues;
  onOpenclawChange: (config: OpenClawAdapterFormValues) => void;
  customConfig: CustomAdapterFormValues;
  onCustomChange: (config: CustomAdapterFormValues) => void;
}

export const StepAdapter: React.FC<StepAdapterProps> = ({
  agentType,
  hermesConfig,
  onHermesChange,
  openclawConfig,
  onOpenclawChange,
  customConfig,
  onCustomChange
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h4 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
          {agentType === "hermes" ? "Hermes Runtime & Gateway Configuration" : agentType === "openclaw" ? "OpenClaw Bridge Settings" : "Custom Protocol Settings"}
        </h4>
        <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
          Configure connection endpoints, API tokens, timeouts, and cryptographic session isolation parameters.
        </p>
      </div>

      <div
        style={{
          padding: "1.5rem",
          borderRadius: "8px",
          backgroundColor: "#fcfbf9",
          border: "1px solid var(--border-subtle)"
        }}
      >
        <AdapterConfig
          agentType={agentType}
          hermesConfig={hermesConfig}
          onHermesChange={onHermesChange}
          openclawConfig={openclawConfig}
          onOpenclawChange={onOpenclawChange}
          customConfig={customConfig}
          onCustomChange={onCustomChange}
        />
      </div>
    </div>
  );
};
