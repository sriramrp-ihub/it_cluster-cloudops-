"use client";

import React from "react";
import { HermesAdapterFormValues, OpenClawAdapterFormValues, CustomAdapterFormValues } from "../../lib/validation";

interface AdapterConfigProps {
  agentType: "hermes" | "openclaw" | "custom";
  hermesConfig: HermesAdapterFormValues;
  onHermesChange: (config: HermesAdapterFormValues) => void;
  openclawConfig: OpenClawAdapterFormValues;
  onOpenclawChange: (config: OpenClawAdapterFormValues) => void;
  customConfig: CustomAdapterFormValues;
  onCustomChange: (config: CustomAdapterFormValues) => void;
}

export const AdapterConfig: React.FC<AdapterConfigProps> = ({
  agentType,
  hermesConfig,
  onHermesChange,
  openclawConfig,
  onOpenclawChange,
  customConfig,
  onCustomChange
}) => {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "4px",
    border: "1px solid var(--warm-gray-border)",
    fontSize: "14px",
    fontFamily: "var(--font-sans)",
    backgroundColor: "var(--pure-white)",
    marginTop: "4px"
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--dark-warm-gray)",
    display: "block",
    marginBottom: "2px"
  };

  const groupStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  };

  if (agentType === "hermes") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
        <div style={groupStyle}>
                  <label style={labelStyle}>Hermes Gateway URL</label>
                  <input
                    type="text"
                    value={hermesConfig.gatewayUrl}
                    onChange={(e) => onHermesChange({ ...hermesConfig, gatewayUrl: e.target.value })}
                    placeholder="http://host.docker.internal:8642"
                    style={inputStyle}
                  />
                  <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>Internal Hermes gateway endpoint</span>
                </div>

                <div style={groupStyle}>
                  <label style={labelStyle}>API Key (API_SERVER_KEY) *</label>
                  <input
                    type="password"
                    value={hermesConfig.apiKey}
                    onChange={(e) => onHermesChange({ ...hermesConfig, apiKey: e.target.value })}
                    placeholder="sk_hermes_live_..."
                    style={inputStyle}
                  />
                  <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>Secret token authenticating with Hermes runtime</span>
                </div>

                <div style={groupStyle}>
                  <label style={labelStyle}>Control Plane API URL</label>
                  <input
                    type="text"
                    value={hermesConfig.paperclipUrl}
                    onChange={(e) => onHermesChange({ ...hermesConfig, paperclipUrl: e.target.value })}
                    placeholder="http://host.docker.internal:3100"
                    style={inputStyle}
                  />
                  <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>CloudOps control plane orchestration endpoint</span>
                </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Session Key Strategy</label>
          <select
            value={hermesConfig.sessionKeyStrategy}
            onChange={(e) => onHermesChange({ ...hermesConfig, sessionKeyStrategy: e.target.value as any })}
            style={inputStyle}
          >
            <option value="scoped">Scoped (Per-investigation isolation)</option>
            <option value="shared">Shared (Tenant-level pooling)</option>
            <option value="static">Static (Persistent runtime token)</option>
          </select>
          <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>Cryptographic session lifecycle governance</span>
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Timeout Seconds</label>
          <input
            type="number"
            value={hermesConfig.timeoutSeconds}
            onChange={(e) => onHermesChange({ ...hermesConfig, timeoutSeconds: Number(e.target.value) || 1800 })}
            style={inputStyle}
          />
          <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>Maximum execution window before cutoff</span>
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Event Reconnect Interval (ms)</label>
          <input
            type="number"
            value={hermesConfig.eventReconnectMs}
            onChange={(e) => onHermesChange({ ...hermesConfig, eventReconnectMs: Number(e.target.value) || 2000 })}
            style={inputStyle}
          />
          <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>WebSocket heartbeat & event re-subscription backoff</span>
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
          <input
            type="checkbox"
            id="allowRemoteHttp"
            checked={hermesConfig.allowRemoteHttp}
            onChange={(e) => onHermesChange({ ...hermesConfig, allowRemoteHttp: e.target.checked })}
            style={{ width: "16px", height: "16px", cursor: "pointer" }}
          />
          <label htmlFor="allowRemoteHttp" style={{ fontSize: "13px", color: "var(--dark-warm-gray)", cursor: "pointer" }}>
            Allow remote non-loopback HTTP bridges (In production, loopback/host-gateway is recommended)
          </label>
        </div>

        <div style={{ gridColumn: "1 / -1", ...groupStyle }}>
          <label style={labelStyle}>Extra Headers (JSON Object)</label>
          <textarea
            value={JSON.stringify(hermesConfig.extraHeaders, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onHermesChange({ ...hermesConfig, extraHeaders: parsed });
              } catch {
                // allow editing
              }
            }}
            rows={3}
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: "12px" }}
            placeholder='{ "x-custom-cluster": "prod-useast1" }'
          />
        </div>
      </div>
    );
  }

  if (agentType === "openclaw") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
        <div style={groupStyle}>
          <label style={labelStyle}>OpenClaw URL</label>
          <input
            type="text"
            value={openclawConfig.openclawUrl}
            onChange={(e) => onOpenclawChange({ ...openclawConfig, openclawUrl: e.target.value })}
            placeholder="http://localhost:8080"
            style={inputStyle}
          />
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>API Key *</label>
          <input
            type="password"
            value={openclawConfig.apiKey}
            onChange={(e) => onOpenclawChange({ ...openclawConfig, apiKey: e.target.value })}
            placeholder="oc_key_live_..."
            style={inputStyle}
          />
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>WebSocket Stream URL</label>
          <input
            type="text"
            value={openclawConfig.wsUrl}
            onChange={(e) => onOpenclawChange({ ...openclawConfig, wsUrl: e.target.value })}
            placeholder="ws://localhost:8080/ws"
            style={inputStyle}
          />
        </div>

        <div style={groupStyle}>
          <label style={labelStyle}>Timeout Seconds</label>
          <input
            type="number"
            value={openclawConfig.timeoutSeconds}
            onChange={(e) => onOpenclawChange({ ...openclawConfig, timeoutSeconds: Number(e.target.value) || 1800 })}
            style={inputStyle}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <label style={labelStyle}>Custom Adapter Configuration (JSON)</label>
      <textarea
        value={customConfig.configJson}
        onChange={(e) => onCustomChange({ configJson: e.target.value })}
        rows={8}
        style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: "13px" }}
        placeholder='{\n  "endpoint": "http://localhost:9000",\n  "protocol": "acp-v1",\n  "auth": { "type": "bearer", "token": "..." }\n}'
      />
      <span style={{ fontSize: "11px", color: "var(--muted-gray)" }}>
        Declare custom adapter parameters conforming to Agent Communication Protocol (ACP).
      </span>
    </div>
  );
};
