"use client";

import React from "react";
import {
  AgentBasicFormValues,
  HermesAdapterFormValues,
  OpenClawAdapterFormValues,
  CustomAdapterFormValues
} from "../../../lib/validation";
import { TrustPreset, PRESET_DESCRIPTIONS } from "../../../components/agents/TrustSelector";
import { SkillItem } from "../../../lib/api";

interface StepReviewProps {
  basic: AgentBasicFormValues;
  adapterType: "hermes" | "openclaw" | "custom";
  hermesConfig: HermesAdapterFormValues;
  openclawConfig: OpenClawAdapterFormValues;
  customConfig: CustomAdapterFormValues;
  trustPreset: TrustPreset;
  selectedCapabilities: string[];
  selectedSkills: string[];
  allSkills: SkillItem[];
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
}

export const StepReview: React.FC<StepReviewProps> = ({
  basic,
  adapterType,
  hermesConfig,
  openclawConfig,
  customConfig,
  trustPreset,
  selectedCapabilities,
  selectedSkills,
  allSkills,
  submitting,
  onSubmit,
  onBack
}) => {
  const presetInfo = PRESET_DESCRIPTIONS[trustPreset];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h4 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
          Review Provisioning Specification
        </h4>
        <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
          Verify all identity, adapter parameters, governance fences, and operational skills before auto-provisioning.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.25rem"
        }}
      >
        {/* Identity Card */}
        <div style={{ padding: "1.25rem", borderRadius: "6px", backgroundColor: "#fafaf9", border: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Agent Identity
          </span>
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div>
              <span style={{ fontSize: "12px", color: "var(--mid-warm-gray)" }}>Name: </span>
              <strong style={{ fontSize: "14px", color: "var(--near-black-ink)" }}>{basic.name}</strong>
            </div>
            <div>
              <span style={{ fontSize: "12px", color: "var(--mid-warm-gray)" }}>Type: </span>
              <span style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: 600, color: "var(--dark-warm-gray)" }}>
                {basic.type}
              </span>
            </div>
            {basic.description && (
              <div>
                <span style={{ fontSize: "12px", color: "var(--mid-warm-gray)" }}>Description: </span>
                <span style={{ fontSize: "12px", color: "var(--dark-warm-gray)" }}>{basic.description}</span>
              </div>
            )}
          </div>
        </div>

        {/* Adapter Card */}
        <div style={{ padding: "1.25rem", borderRadius: "6px", backgroundColor: "#fafaf9", border: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Adapter &amp; Runtime
          </span>
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            {adapterType === "hermes" ? (
              <>
                <div><span style={{ color: "var(--muted-gray)" }}>Gateway:</span> <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{hermesConfig.gatewayUrl}</span></div>
                <div><span style={{ color: "var(--muted-gray)" }}>Paperclip:</span> <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{hermesConfig.paperclipUrl}</span></div>
                <div><span style={{ color: "var(--muted-gray)" }}>Session Key:</span> <span style={{ textTransform: "capitalize" }}>{hermesConfig.sessionKeyStrategy}</span></div>
                <div><span style={{ color: "var(--muted-gray)" }}>Timeout:</span> {hermesConfig.timeoutSeconds}s</div>
              </>
            ) : adapterType === "openclaw" ? (
              <>
                <div><span style={{ color: "var(--muted-gray)" }}>OpenClaw URL:</span> <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{openclawConfig.openclawUrl}</span></div>
                <div><span style={{ color: "var(--muted-gray)" }}>Stream:</span> <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>{openclawConfig.wsUrl}</span></div>
              </>
            ) : (
              <div><span style={{ color: "var(--muted-gray)" }}>Custom JSON Protocol Config</span></div>
            )}
          </div>
        </div>

        {/* Trust Card */}
        <div style={{ padding: "1.25rem", borderRadius: "6px", backgroundColor: "#fafaf9", border: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Trust &amp; Governance
          </span>
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "var(--muted-gray)" }}>Preset:</span>
              <strong style={{ textTransform: "capitalize", color: "var(--near-black-ink)" }}>{trustPreset}</strong>
              <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", backgroundColor: presetInfo.tagBg, color: presetInfo.tagColor, fontWeight: 600 }}>
                {presetInfo.tag}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--muted-gray)" }}>Authorized Capabilities:</span>{" "}
              <strong>{selectedCapabilities.length} capabilities</strong>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
              {selectedCapabilities.slice(0, 5).map((cap) => (
                <span key={cap} style={{ fontSize: "10px", fontFamily: "var(--font-mono)", backgroundColor: "#edece9", padding: "2px 5px", borderRadius: "3px" }}>
                  {cap}
                </span>
              ))}
              {selectedCapabilities.length > 5 && (
                <span style={{ fontSize: "10px", color: "var(--muted-gray)", padding: "2px 4px" }}>
                  +{selectedCapabilities.length - 5} more
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Skills Card */}
        <div style={{ padding: "1.25rem", borderRadius: "6px", backgroundColor: "#fafaf9", border: "1px solid var(--border-subtle)" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted-gray)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Active Skills
          </span>
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            <div>
              <span style={{ color: "var(--muted-gray)" }}>Built-in Core Skills:</span> <strong>3 active</strong>
            </div>
            <div>
              <span style={{ color: "var(--muted-gray)" }}>Company Workflows:</span>{" "}
              <strong>{selectedSkills.length} selected</strong>
            </div>
            {selectedSkills.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                {selectedSkills.map((sId) => {
                  const s = allSkills.find((k) => k.id === sId);
                  return (
                    <span key={sId} style={{ fontSize: "10px", backgroundColor: "#edece9", padding: "2px 6px", borderRadius: "3px" }}>
                      {s?.name || sId}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          style={{
            padding: "10px 20px",
            fontSize: "14px",
            fontWeight: 500,
            borderRadius: "4px",
            border: "1px solid var(--warm-gray-border)",
            backgroundColor: "#ffffff",
            cursor: submitting ? "not-allowed" : "pointer"
          }}
        >
          &larr; Back to Skills
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          style={{
            padding: "10px 28px",
            fontSize: "14px",
            fontWeight: 600,
            borderRadius: "4px",
            border: "none",
            backgroundColor: "var(--near-black-ink)",
            color: "#ffffff",
            cursor: submitting ? "not-allowed" : "pointer",
            boxShadow: "0 2px 8px rgba(15, 14, 13, 0.15)"
          }}
        >
          {submitting ? "Auto-Provisioning..." : "Create & Auto-Provision Agent"}
        </button>
      </div>
    </div>
  );
};
