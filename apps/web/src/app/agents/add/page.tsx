"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createInvite, CreateInviteResponse } from "../../../lib/api";
import { useOperator } from "../../../auth/OperatorContext";

export default function AddAgentPage() {
  const { session } = useOperator();

  // Wizard state (Step 1 -> Step 2 -> Step 3 -> Step 4)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Form State
  const [agentName, setAgentName] = useState("Hermes SRE");
  const [instructions, setInstructions] = useState("Operate AWS ECS and CloudWatch infrastructure for production.");
  const [agentRuntime, setAgentRuntime] = useState<"hermes" | "openclaw" | "custom">("hermes");
  const [selectedCaps, setSelectedCaps] = useState<string[]>([
    "aws.ecs.describe_clusters",
    "aws.ecs.list_tasks",
    "aws.cloudwatch.get_metric_data"
  ]);
  const [expiresInHours, setExpiresInHours] = useState(24);

  // Invite Result
  const [inviteResult, setInviteResult] = useState<CreateInviteResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTestHarness, setShowTestHarness] = useState(false);
  const [simSuccessMsg, setSimSuccessMsg] = useState<string | null>(null);

  const [customCapInput, setCustomCapInput] = useState("");
  const [activePreset, setActivePreset] = useState<string>("sre");
  const [mcpTab, setMcpTab] = useState<"hermes" | "claude" | "cursor" | "sse">("hermes");
  const [copiedMcp, setCopiedMcp] = useState(false);

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

  const handleToggleCap = (cap: string) => {
    setSelectedCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleAddCustomCap = () => {
    const trimmed = customCapInput.trim();
    if (trimmed && !selectedCaps.includes(trimmed)) {
      setSelectedCaps((prev) => [...prev, trimmed]);
      setCustomCapInput("");
    }
  };

  const handleApplyPreset = (presetName: string, caps: string[]) => {
    setActivePreset(presetName);
    setSelectedCaps(caps);
  };

  async function handleGenerateInvitation() {
    if (!agentName.trim()) {
      setErrorMsg("Agent name is required.");
      return;
    }

    setGenerating(true);
    setErrorMsg(null);

    try {
      const res = await createInvite(tenantId, operatorId, {
        expiresInSeconds: expiresInHours * 3600,
        agentName: agentName.trim(),
        agentType: agentRuntime,
        instructions: instructions.trim() || undefined
      });

      setInviteResult(res);
      setCurrentStep(4);
    } catch (err: any) {
      setErrorMsg(`Failed to create agent invitation: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  function copyPrompt() {
    if (!inviteResult?.onboardingPrompt) return;
    navigator.clipboard.writeText(inviteResult.onboardingPrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  }

  function getMcpConfigSnippet(tab: "hermes" | "claude" | "cursor" | "sse"): string {
    const slug = agentName.toLowerCase().replace(/[^a-z0-9]/g, "_") || "agent";
    const agentIdPlaceholder = `ag_${slug}_mcp`;
    if (tab === "hermes") {
      return `# Add CloudOps Governed MCP Server to Hermes CLI
hermes mcp add cloudops npx @cloudops/connector --mcp --agent-id "${agentIdPlaceholder}" --tenant-id "${tenantId}"`;
    }
    if (tab === "claude") {
      return JSON.stringify(
        {
          mcpServers: {
            cloudops: {
              command: "npx",
              args: [
                "@cloudops/connector",
                "--mcp",
                "--agent-id",
                agentIdPlaceholder,
                "--tenant-id",
                tenantId
              ]
            }
          }
        },
        null,
        2
      );
    }
    if (tab === "cursor") {
      return JSON.stringify(
        {
          mcpServers: {
            cloudops: {
              command: "npx",
              args: [
                "@cloudops/connector",
                "--mcp",
                "--agent-id",
                agentIdPlaceholder,
                "--tenant-id",
                tenantId
              ]
            }
          }
        },
        null,
        2
      );
    }
    return `# Universal HTTP / Server-Sent Events (SSE) Transport
SSE Endpoint:  ${apiBase}/v1/mcp/sse?agentId=${agentIdPlaceholder}&tenantId=${tenantId}
Messages POST: ${apiBase}/v1/mcp/messages

# Connect via standard MCP SSE client or curl:
curl -N -H "Accept: text/event-stream" "${apiBase}/v1/mcp/sse?agentId=${agentIdPlaceholder}&tenantId=${tenantId}"`;
  }

  function copyMcpConfig() {
    const snippet = getMcpConfigSnippet(mcpTab);
    navigator.clipboard.writeText(snippet);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 2000);
  }

  // Developer Test Harness simulation
  async function handleSimulateJoin() {
    if (!inviteResult?.inviteToken) return;
    setErrorMsg(null);
    setSimSuccessMsg(null);
    try {
      const joinRes = await fetch(`${apiBase}/v1/onboarding/${inviteResult.inviteToken}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: { name: agentName.trim(), type: agentRuntime },
          runtime: { name: `${agentRuntime}-runtime`, version: "1.2.0", protocol: "acp" },
          requestedCapabilities: selectedCaps
        })
      });
      if (!joinRes.ok) {
        const err = await joinRes.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${joinRes.status}`);
      }
      const data = await joinRes.json();
      setSimSuccessMsg(`Simulation success! Join request created: ${data.joinRequestId}`);
    } catch (err: any) {
      setErrorMsg(`Simulation failed: ${err.message}`);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      {/* 1. Header */}
      <div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: "var(--near-black-ink)",
              background: "#edece9",
              border: "1px solid var(--warm-gray-border)",
              padding: "2px 7px",
              borderRadius: "var(--radius-sm)",
              textTransform: "uppercase"
            }}
          >
            Onboarding Wizard
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Add Agent
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Connect an autonomous CloudOps operations agent in four clear steps.
        </p>
      </div>

      {/* 2. Wizard Step Navigation Bar */}
      <div className="wizard-steps-header">
        <div className={`wizard-step-item ${currentStep === 1 ? "active" : currentStep > 1 ? "completed" : ""}`}>
          <div className="wizard-step-number">
            {currentStep > 1 ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              "1"
            )}
          </div>
          <span>Name & Role</span>
        </div>

        <span style={{ color: "var(--warm-gray-border)" }}>—</span>

        <div className={`wizard-step-item ${currentStep === 2 ? "active" : currentStep > 2 ? "completed" : ""}`}>
          <div className="wizard-step-number">
            {currentStep > 2 ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              "2"
            )}
          </div>
          <span>Runtime</span>
        </div>

        <span style={{ color: "var(--warm-gray-border)" }}>—</span>

        <div className={`wizard-step-item ${currentStep === 3 ? "active" : currentStep > 3 ? "completed" : ""}`}>
          <div className="wizard-step-number">
            {currentStep > 3 ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              "3"
            )}
          </div>
          <span>Capabilities</span>
        </div>

        <span style={{ color: "var(--warm-gray-border)" }}>—</span>

        <div className={`wizard-step-item ${currentStep === 4 ? "active" : ""}`}>
          <div className="wizard-step-number">4</div>
          <span>Invitation Ready</span>
        </div>
      </div>

      {/* 3. Error Alert */}
      {errorMsg && (
        <div className="alert-banner error">
          <div>{errorMsg}</div>
        </div>
      )}

      {/* 4. Wizard Step Containers */}

      {/* Step 1: Name & Assignment */}
      {currentStep === 1 && (
        <div className="harvey-card" style={{ padding: "28px 32px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", marginBottom: "4px" }}>
            Step 1: Agent Name & Purpose
          </h2>
          <p className="body-subtle" style={{ marginBottom: "20px", fontSize: "13.5px" }}>
            Identify this operational agent in your tenant's fleet.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="form-group">
              <label className="form-label">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="form-input"
                placeholder="e.g. Hermes SRE"
                style={{ maxWidth: "420px" }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Operational Assignment (Optional)</label>
              <textarea
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="form-input"
                placeholder="e.g. Operate AWS ECS and CloudWatch infrastructure for production."
                style={{ resize: "vertical" }}
              />
            </div>

            <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  if (agentName.trim()) setCurrentStep(2);
                  else setErrorMsg("Please provide an agent name.");
                }}
                className="btn-primary"
                style={{ padding: "10px 24px" }}
              >
                Continue to Runtime
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Choose Runtime */}
      {currentStep === 2 && (
        <div className="harvey-card" style={{ padding: "28px 32px" }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", marginBottom: "4px" }}>
            Step 2: Choose Runtime Framework
          </h2>
          <p className="body-subtle" style={{ marginBottom: "20px", fontSize: "13.5px" }}>
            Select the autonomous agent engine powering this worker.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "24px" }}>
            {[
              { id: "hermes", name: "Hermes", desc: "Autonomous SRE & Investigation Agent" },
              { id: "openclaw", name: "OpenClaw", desc: "Operational Automation Daemon" },
              { id: "custom", name: "Custom", desc: "Generic ACP Transport Protocol" }
            ].map((rt) => (
              <button
                key={rt.id}
                type="button"
                onClick={() => setAgentRuntime(rt.id as any)}
                style={{
                  padding: "16px",
                  background: agentRuntime === rt.id ? "var(--near-black-ink)" : "#ffffff",
                  color: agentRuntime === rt.id ? "#ffffff" : "var(--near-black-ink)",
                  border: `1px solid ${agentRuntime === rt.id ? "var(--near-black-ink)" : "var(--warm-gray-border)"}`,
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  textAlign: "left"
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "15px" }}>{rt.name}</div>
                <div style={{ fontSize: "12px", opacity: 0.8, marginTop: "4px" }}>{rt.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="btn-secondary"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="btn-primary"
              style={{ padding: "10px 24px" }}
            >
              Continue to Capabilities
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Capabilities & MCP Scopes */}
      {currentStep === 3 && (
        <div className="harvey-card" style={{ padding: "28px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)" }}>
              Step 3: Capabilities & MCP Toolsets
            </h2>
            <span style={{ fontSize: "11px", fontWeight: 600, padding: "3px 8px", borderRadius: "12px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
              {selectedCaps.length} scopes selected
            </span>
          </div>

          <p className="body-subtle" style={{ marginBottom: "18px", fontSize: "13.5px" }}>
            Define the Model Context Protocol (MCP) toolsets and operational boundaries for this agent.
          </p>

          {/* Zero-Code MCP Governance: CloudOps invokes tools dynamically via standardized MCP servers while enforcing policy, human-in-the-loop approvals, and audit logging. */}

          {/* Role Presets */}
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--mid-warm-gray)", marginBottom: "8px" }}>
              Cloud Presets
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => handleApplyPreset("all", [
                  "aws.ecs.describe_clusters",
                  "aws.ecs.list_tasks",
                  "aws.cloudwatch.get_metric_data",
                  "aws.ecs.update_service",
                  "aws.rds.reboot_db_instance",
                  "gcp.run.services_list",
                  "gcp.monitoring.time_series_query",
                  "gcp.run.services_restart",
                  "azure.container_apps.list",
                  "azure.monitor.metrics_query",
                  "azure.container_apps.restart"
                ])}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: activePreset === "all" ? "1px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                  background: activePreset === "all" ? "#0f0e0d" : "#ffffff",
                  color: activePreset === "all" ? "#ffffff" : "var(--near-black-ink)",
                  cursor: "pointer"
                }}
              >
                Full Multi-Cloud SRE (AWS + GCP + Azure)
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset("aws", [
                  "aws.ecs.describe_clusters",
                  "aws.ecs.list_tasks",
                  "aws.cloudwatch.get_metric_data",
                  "aws.ecs.update_service",
                  "aws.rds.reboot_db_instance"
                ])}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: activePreset === "aws" ? "1px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                  background: activePreset === "aws" ? "#0f0e0d" : "#ffffff",
                  color: activePreset === "aws" ? "#ffffff" : "var(--near-black-ink)",
                  cursor: "pointer"
                }}
              >
                AWS Cloud Operator
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset("gcp", [
                  "gcp.run.services_list",
                  "gcp.compute.instances_list",
                  "gcp.monitoring.time_series_query",
                  "gcp.run.services_restart",
                  "gcp.sql.instances_restart"
                ])}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: activePreset === "gcp" ? "1px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                  background: activePreset === "gcp" ? "#0f0e0d" : "#ffffff",
                  color: activePreset === "gcp" ? "#ffffff" : "var(--near-black-ink)",
                  cursor: "pointer"
                }}
              >
                GCP Cloud Operator
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset("azure", [
                  "azure.container_apps.list",
                  "azure.vm.list",
                  "azure.monitor.metrics_query",
                  "azure.container_apps.restart",
                  "azure.database.restart"
                ])}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: activePreset === "azure" ? "1px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                  background: activePreset === "azure" ? "#0f0e0d" : "#ffffff",
                  color: activePreset === "azure" ? "#ffffff" : "var(--near-black-ink)",
                  cursor: "pointer"
                }}
              >
                Azure Cloud Operator
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset("observer", [
                  "aws.ecs.describe_clusters",
                  "aws.cloudwatch.get_metric_data",
                  "gcp.run.services_list",
                  "gcp.monitoring.time_series_query",
                  "azure.container_apps.list",
                  "azure.monitor.metrics_query"
                ])}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: activePreset === "observer" ? "1px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                  background: activePreset === "observer" ? "#0f0e0d" : "#ffffff",
                  color: activePreset === "observer" ? "#ffffff" : "var(--near-black-ink)",
                  cursor: "pointer"
                }}
              >
                Multi-Cloud Read-Only Observer
              </button>
            </div>
          </div>

          {/* MCP Toolsets List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
            {/* AWS MCP Toolset */}
            <div style={{ border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#fcfbf9", borderBottom: "1px solid var(--warm-gray-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  AWS Cloud Operations MCP
                </span>
                <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)" }}>Provider: AWS STS AssumeRole</span>
              </div>
              <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { id: "aws.ecs.describe_clusters", name: "ECS Cluster & Task Read", desc: "List & describe clusters, services, and tasks", type: "read" },
                  { id: "aws.ecs.list_tasks", name: "ECS Task List", desc: "List container task definitions and revisions", type: "read" },
                  { id: "aws.cloudwatch.get_metric_data", name: "CloudWatch Telemetry", desc: "Fetch metrics, CPU/memory, & alarm states", type: "read" },
                  { id: "aws.ecs.update_service", name: "ECS Service Scale / Restart", desc: "Mutate task count or force new deployment", type: "mutation" },
                  { id: "aws.rds.reboot_db_instance", name: "RDS Reboot & Failover", desc: "Initiate database reboot or multi-AZ failover", type: "mutation" }
                ].map((cap) => {
                  const isChecked = selectedCaps.includes(cap.id);
                  return (
                    <label key={cap.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "6px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCap(cap.id)}
                        />
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--near-black-ink)" }}>{cap.name}</span>
                          <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", marginLeft: "8px" }}>{cap.desc}</span>
                        </div>
                      </div>
                      <span style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: cap.type === "mutation" ? "#fef3c7" : "#f1f5f9",
                        color: cap.type === "mutation" ? "#92400e" : "#475569"
                      }}>
                        {cap.type === "mutation" ? "APPROVAL GATE" : "READ-ONLY"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* GCP MCP Toolset */}
            <div style={{ border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#fcfbf9", borderBottom: "1px solid var(--warm-gray-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  GCP Cloud Operations MCP
                </span>
                <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)" }}>Provider: Google Workload Identity</span>
              </div>
              <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { id: "gcp.run.services_list", name: "Cloud Run Services Read", desc: "List and describe serverless Cloud Run services", type: "read" },
                  { id: "gcp.compute.instances_list", name: "Compute Engine (GCE) Read", desc: "Inspect VM instance health and zone topologies", type: "read" },
                  { id: "gcp.monitoring.time_series_query", name: "Cloud Monitoring Telemetry", desc: "Query Cloud Monitoring time-series metrics", type: "read" },
                  { id: "gcp.run.services_restart", name: "Cloud Run Restart / Re-deploy", desc: "Roll out new revisions or scale traffic", type: "mutation" },
                  { id: "gcp.sql.instances_restart", name: "Cloud SQL Reboot / Failover", desc: "Trigger Cloud SQL restart or failover", type: "mutation" }
                ].map((cap) => {
                  const isChecked = selectedCaps.includes(cap.id);
                  return (
                    <label key={cap.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "6px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCap(cap.id)}
                        />
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--near-black-ink)" }}>{cap.name}</span>
                          <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", marginLeft: "8px" }}>{cap.desc}</span>
                        </div>
                      </div>
                      <span style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: cap.type === "mutation" ? "#fef3c7" : "#f1f5f9",
                        color: cap.type === "mutation" ? "#92400e" : "#475569"
                      }}>
                        {cap.type === "mutation" ? "APPROVAL GATE" : "READ-ONLY"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Azure MCP Toolset */}
            <div style={{ border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#fcfbf9", borderBottom: "1px solid var(--warm-gray-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  Azure Cloud Operations MCP
                </span>
                <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)" }}>Provider: Azure Service Principal</span>
              </div>
              <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { id: "azure.container_apps.list", name: "Container Apps Read", desc: "List and describe Azure Container App environments", type: "read" },
                  { id: "azure.vm.list", name: "Virtual Machines (VM) Read", desc: "Inspect Azure VM availability and power states", type: "read" },
                  { id: "azure.monitor.metrics_query", name: "Azure Monitor Telemetry", desc: "Query resource metrics and alerts", type: "read" },
                  { id: "azure.container_apps.restart", name: "Container App Restart", desc: "Trigger revision restart or replica scaling", type: "mutation" },
                  { id: "azure.database.restart", name: "Azure Database Failover / Restart", desc: "Restart PostgreSQL/MySQL flexible servers", type: "mutation" }
                ].map((cap) => {
                  const isChecked = selectedCaps.includes(cap.id);
                  return (
                    <label key={cap.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "6px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleCap(cap.id)}
                        />
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--near-black-ink)" }}>{cap.name}</span>
                          <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", marginLeft: "8px" }}>{cap.desc}</span>
                        </div>
                      </div>
                      <span style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: cap.type === "mutation" ? "#fef3c7" : "#f1f5f9",
                        color: cap.type === "mutation" ? "#92400e" : "#475569"
                      }}>
                        {cap.type === "mutation" ? "APPROVAL GATE" : "READ-ONLY"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Custom Cloud Scope / Wildcard Adder */}
            <div style={{ border: "1px dashed var(--warm-gray-border)", borderRadius: "var(--radius-sm)", padding: "12px 14px", background: "#ffffff" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "8px" }}>
                Add Custom Cloud Scope or Wildcard
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="e.g. aws.lambda.*, gcp.bigquery.*, or azure.aks.*"
                  value={customCapInput}
                  onChange={(e) => setCustomCapInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomCap();
                    }
                  }}
                  className="form-input"
                  style={{ flex: 1, fontSize: "13px" }}
                />
                <button
                  type="button"
                  onClick={handleAddCustomCap}
                  className="btn-secondary"
                  style={{ fontSize: "12px", whiteSpace: "nowrap" }}
                >
                  + Add Scope
                </button>
              </div>

              {/* Custom tags pills */}
              {selectedCaps.some(c => !c.startsWith("aws.") && !c.startsWith("gcp.") && !c.startsWith("azure.")) && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                  {selectedCaps
                    .filter(c => !c.startsWith("aws.") && !c.startsWith("gcp.") && !c.startsWith("azure."))
                    .map(cap => (
                      <span
                        key={cap}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: "#f1f5f9",
                          fontSize: "11px",
                          fontFamily: "var(--font-mono, monospace)"
                        }}
                      >
                        {cap}
                        <button
                          type="button"
                          onClick={() => handleToggleCap(cap)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontWeight: "bold" }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div className="form-group" style={{ maxWidth: "260px", marginBottom: "24px" }}>
            <label className="form-label">Invitation Expiration</label>
            <select
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(Number(e.target.value))}
              className="form-input"
            >
              <option value={1}>1 Hour (Quick Setup)</option>
              <option value={24}>24 Hours (Standard)</option>
              <option value={72}>3 Days</option>
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="btn-secondary"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleGenerateInvitation}
              disabled={generating}
              className="btn-primary"
              style={{ padding: "10px 24px" }}
            >
              {generating ? "Generating..." : "Generate Invitation Prompt"}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Invitation Ready */}
      {currentStep === 4 && inviteResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="harvey-card" style={{ padding: "28px 32px", border: "1px solid var(--near-black-ink)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                    Invitation Ready
                  </h2>
                </div>
                <p className="body-subtle" style={{ margin: 0, fontSize: "13.5px" }}>
                  Give this prompt to your agent ({agentName} · {agentRuntime}).
                </p>
              </div>

              <button
                type="button"
                onClick={copyPrompt}
                className="btn-primary"
                style={{ padding: "8px 20px", fontSize: "13px" }}
              >
                {copiedPrompt ? "Prompt Copied" : "Copy Prompt"}
              </button>
            </div>

            {/* Architecture note: Control Plane API runs on port 3000, Operator Web UI runs on port 3001 */}

            {/* Prompt Pre Box */}
            <pre
              style={{
                background: "#0f0e0d",
                color: "#f5f5f4",
                padding: "18px",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                lineHeight: 1.6,
                maxHeight: "320px",
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }}
            >
              {inviteResult.onboardingPrompt}
            </pre>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
              <span>Single-use invitation token (Hashed at rest)</span>
              <span>Expires: {new Date(inviteResult.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>

          {/* Governed MCP Server Integration Section */}
          <div className="harvey-card" style={{ padding: "24px 28px", border: "1px solid var(--warm-gray-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                  <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "20px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                    Governed Model Context Protocol (MCP) Setup
                  </h3>
                </div>
                <p className="body-subtle" style={{ margin: 0, fontSize: "13px" }}>
                  Connect Hermes, Claude Desktop, Cursor, or any MCP-compliant agent. CloudOps governs tools, intercepts mutations for approval, and audits operations.
                </p>
              </div>

              <button
                type="button"
                onClick={copyMcpConfig}
                className="btn-primary"
                style={{ padding: "6px 16px", fontSize: "12.5px" }}
              >
                {copiedMcp ? "Config Copied" : "Copy Configuration"}
              </button>
            </div>

            {/* Tab navigation */}
            <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px", marginBottom: "14px" }}>
              {(["hermes", "claude", "cursor", "sse"] as const).map((tab) => {
                const labels: Record<string, string> = {
                  hermes: "Hermes CLI (stdio)",
                  claude: "Claude Desktop",
                  cursor: "Cursor IDE",
                  sse: "Universal SSE (HTTP)"
                };
                const isActive = mcpTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMcpTab(tab)}
                    style={{
                      padding: "5px 12px",
                      fontSize: "12px",
                      fontWeight: isActive ? 600 : 400,
                      borderRadius: "4px",
                      border: "none",
                      background: isActive ? "var(--near-black-ink)" : "transparent",
                      color: isActive ? "#ffffff" : "var(--mid-warm-gray)",
                      cursor: "pointer"
                    }}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>

            {/* Snippet box */}
            <pre
              style={{
                background: "#0f0e0d",
                color: "#f5f5f4",
                padding: "16px",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                lineHeight: 1.5,
                margin: 0,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }}
            >
              {getMcpConfigSnippet(mcpTab)}
            </pre>

            {/* Security Invariant */}
            <div style={{ marginTop: "12px", fontSize: "12px", color: "#475569", display: "flex", alignItems: "center", gap: "6px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              <span><strong>Zero Root Cloud Keys:</strong> The agent never holds cloud credentials. Mutations pause for Human-in-the-Loop operator sign-off.</span>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center" }}>
            <Link href="/agents/join-requests" className="btn-secondary">
              Go to Join Requests Queue
            </Link>
          </div>

          {/* Note: Local simulation test harness omitted from production operator interface */}
        </div>
      )}
    </div>
  );
}
