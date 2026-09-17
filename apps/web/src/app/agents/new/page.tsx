"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AgentWizard, WizardStepMeta } from "../../../components/agents/AgentWizard";
import { StepInvite } from "./step-invite";
import { StepBasic } from "./step-basic";
import { StepAdapter } from "./step-adapter";
import { StepTrust } from "./step-trust";
import { StepSkills } from "./step-skills";
import { StepReview } from "./step-review";
import { StepProvision } from "./step-provision";
import { ProvisionStep } from "../../../components/agents/ProvisionProgress";
import {
  AgentBasicFormValues,
  HermesAdapterFormValues,
  OpenClawAdapterFormValues,
  CustomAdapterFormValues
} from "../../../lib/validation";
import { TrustPreset } from "../../../components/agents/TrustSelector";
import { useCapabilities } from "../../../hooks/useCapabilities";
import { useSkills } from "../../../hooks/useSkills";
import { useOperator } from "../../../auth/OperatorContext";
import { connectAgent, testAgent } from "../../../lib/api";

const WIZARD_STEPS: WizardStepMeta[] = [
  { number: 0, title: "Invite Token", description: "Paste operator token" },
  { number: 1, title: "Basic Info", description: "Identity & Type" },
  { number: 2, title: "Adapter", description: "Runtime Protocol" },
  { number: 3, title: "Trust", description: "Fences & Scopes" },
  { number: 4, title: "Skills", description: "Workflows" },
  { number: 5, title: "Review", description: "Verify Spec" },
  { number: 6, title: "Provision", description: "Auto-Provision" }
];

export default function NewAgentWizardPage() {
  const router = useRouter();
  const { session, isOperator: contextIsOperator } = useOperator();
  const isOperator = contextIsOperator ?? Boolean(session?.operatorId);
  const { capabilities, loading: loadingCaps } = useCapabilities();
  const { skills, loading: loadingSkills } = useSkills();

  const [currentStep, setCurrentStep] = useState(0); // Start at Step 0 (Invite Token)
  const [basicErrors, setBasicErrors] = useState<Record<string, string>>({});
  const [inviteToken, setInviteToken] = useState("");
  const [inviteValidated, setInviteValidated] = useState(false);
  const [inviteData, setInviteData] = useState<{ tenantId: string; expiresAt: string; joinRequestId?: string } | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(false);

  // Form State
  const [basicInfo, setBasicInfo] = useState<AgentBasicFormValues>({
    name: "",
    type: "hermes",
    description: ""
  });

  const [hermesConfig, setHermesConfig] = useState<HermesAdapterFormValues>({
    gatewayUrl: "http://host.docker.internal:8642",
    apiKey: "",
    paperclipUrl: "http://host.docker.internal:3100",
    sessionKeyStrategy: "scoped",
    timeoutSeconds: 1800,
    eventReconnectMs: 2000,
    allowRemoteHttp: false,
    extraHeaders: {}
  });

  const [openclawConfig, setOpenclawConfig] = useState<OpenClawAdapterFormValues>({
    openclawUrl: "http://localhost:8080",
    apiKey: "",
    wsUrl: "ws://localhost:8080/ws",
    timeoutSeconds: 1800
  });

  const [customConfig, setCustomConfig] = useState<CustomAdapterFormValues>({
    configJson: JSON.stringify({ endpoint: "http://localhost:9000", protocol: "acp-v1" }, null, 2)
  });

  const [trustPreset, setTrustPreset] = useState<TrustPreset>("standard");
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // Auto-Provision State
  const [provisionSteps, setProvisionSteps] = useState<ProvisionStep[]>([
    { id: 1, label: "Submitting join request...", status: "pending" },
    { id: 2, label: "Waiting for operator approval...", status: "pending" },
    { id: 3, label: "Claiming bootstrap credential...", status: "pending" },
    { id: 4, label: "Starting connector sidecar...", status: "pending" },
    { id: 5, label: "Registering MCP endpoint...", status: "pending" },
    { id: 6, label: "Testing connection...", status: "pending" }
  ]);
  const [isProvisionComplete, setIsProvisionComplete] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<string | undefined>(undefined);
  const [createdMcpSseUrl, setCreatedMcpSseUrl] = useState<string | undefined>(undefined);
  const [createdConnectorPid, setCreatedConnectorPid] = useState<number | undefined>(undefined);
  const [discoveredTools, setDiscoveredTools] = useState<string[]>([]);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Initialize capabilities based on standard preset when capabilities load
  useEffect(() => {
    if (capabilities.length > 0 && selectedCapabilities.length === 0) {
      const standardCaps = capabilities
        .filter((c) => c.tier === "read" || c.tier === "mutate")
        .map((c) => c.id);
      setSelectedCapabilities(standardCaps);
    }
  }, [capabilities, selectedCapabilities.length]);

  // Step Navigation Validation
  const handleNext = () => {
    if (currentStep === 0) {
      if (!inviteToken || inviteToken.trim().length === 0) {
        setBasicErrors({ invite: "Invite token is required" });
        return;
      }
      setBasicErrors({});
      // Validate invite token
      validateInviteToken();
      return;
    }
    if (currentStep === 1) {
      if (!basicInfo.name || basicInfo.name.trim().length === 0) {
        setBasicErrors({ name: "Agent name is required" });
        return;
      }
      setBasicErrors({});
    }
    setCurrentStep((prev) => Math.min(prev + 1, 6));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const validateInviteToken = async (tokenOverride?: string) => {
    const token = (tokenOverride !== undefined ? tokenOverride : inviteToken).trim();
    if (!token) {
      setBasicErrors({ invite: "Invite token is required" });
      return;
    }
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    setBasicErrors({});
    try {
      const res = await fetch(`${apiBase}/v1/onboarding/${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setBasicErrors({ invite: err?.error?.message || err?.message || "Invalid invite token" });
        return;
      }
      const data = await res.json();
      if (data.lifecycleState !== "INVITE_ACTIVE") {
        setBasicErrors({ invite: `Invite is ${data.lifecycleState.toLowerCase()}, expected ACTIVE` });
        return;
      }
      setInviteValidated(true);
      setInviteData({
        tenantId: data.tenantId,
        expiresAt: data.expiresAt || "",
        joinRequestId: data.joinRequestId
      });
      setCurrentStep(1);
    } catch (err: any) {
      setBasicErrors({ invite: err?.message || "Failed to validate invite token" });
    }
  };

  const handleCreateInvite = async () => {
    setLoadingInvite(true);
    setBasicErrors({});
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
    const tenantId = session?.tenantId || "ten_default_tenant";
    const operatorId = session?.operatorId || "op_admin_operator";

    try {
      const res = await fetch(`${apiBase}/v1/agent-invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "x-operator-id": operatorId
        },
        body: JSON.stringify({
          ttlSeconds: 86400,
          expiresInSeconds: 86400,
          agentName: basicInfo.name || undefined,
          agentType: basicInfo.type || undefined
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || err?.message || "Failed to generate invite token");
      }

      const data = await res.json();
      const token = data.inviteToken;
      setInviteToken(token);

      // Auto-validate and auto-advance to Step 1
      await validateInviteToken(token);
    } catch (err: any) {
      setBasicErrors({ invite: err?.message || "Failed to generate invite token" });
    } finally {
      setLoadingInvite(false);
    }
  };

  // Execution: End-to-end Auto-Provisioning Flow
  const handleStartProvisioning = async () => {
    setCurrentStep(6);
    setSubmitting(true);
    setProvisionError(null);

    const updateStep = (id: number, status: "pending" | "running" | "completed" | "error", detail?: string) => {
      setProvisionSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status, detail } : s))
      );
    };

    const tenantId = inviteData?.tenantId || session?.tenantId || "ten_default_tenant";
    const operatorId = session?.operatorId || "op_admin_operator";
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

    try {
      // Step 1: Submitting join request
      updateStep(1, "running", "Submitting ACP join request with declared capabilities...");
      const joinRes = await fetch(`${apiBase}/v1/onboarding/${inviteToken.trim()}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: {
            name: basicInfo.name,
            type: basicInfo.type,
            version: "1.0.0"
          },
          runtime: {
            name: `${basicInfo.type}-runtime`,
            version: "1.0.0",
            protocol: "acp"
          },
          requestedCapabilities: selectedCapabilities
        })
      });

      if (!joinRes.ok) {
        const err = await joinRes.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to submit join request");
      }
      const joinData = await joinRes.json();
      const joinRequestId = joinData.joinRequestId;
      updateStep(1, "completed", `Request ID: ${joinRequestId}`);

      // Step 2: Waiting for operator approval (Operator auto-approval)
      updateStep(2, "running", "Auto-approving join request under active operator authority...");
      const approveRes = await fetch(`${apiBase}/v1/agent-join-requests/${joinRequestId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "x-operator-id": operatorId
        },
        body: JSON.stringify({
          decision: "APPROVE",
          grantedCapabilities: selectedCapabilities
        })
      });

      if (!approveRes.ok) {
        const err = await approveRes.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to approve join request");
      }
      const approveData = await approveRes.json();
      const agentId = approveData.agentId || joinData.agentId;
      setCreatedAgentId(agentId);
      updateStep(2, "completed", `Approved by ${operatorId} -> Agent ${agentId}`);

      // Step 3: Claiming bootstrap credential
      updateStep(3, "running", "Exchanging approval token for bootstrap credential...");
      const claimRes = await fetch(`${apiBase}/v1/onboarding/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinRequestId })
      });

      if (!claimRes.ok) {
        const err = await claimRes.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Failed to claim bootstrap credential");
      }
      const claimData = await claimRes.json();
      updateStep(3, "completed", `Credential issued for ${claimData.agentId}`);

      // Step 4: Starting connector sidecar
      updateStep(4, "running", "Spawning connector daemon process (--daemon --mcp-port 0)...");
      const connectData = await connectAgent(agentId, true, tenantId, operatorId);
      setCreatedMcpSseUrl(connectData.mcpSseUrl);
      setCreatedConnectorPid(connectData.connectorPid);
      updateStep(4, "completed", `Daemon active: PID ${connectData.connectorPid}`);

      // Step 5: Registering MCP endpoint
      updateStep(5, "running", "Exposing isolated MCP SSE stream...");
      updateStep(5, "completed", `Bound to ${connectData.mcpSseUrl}`);

      // Step 6: Testing connection
      updateStep(6, "running", "Connecting MCP verifier and probing read capability...");
      const testData = await testAgent(agentId, tenantId, operatorId);
      if (testData.success && testData.mcpTools) {
        setDiscoveredTools(testData.mcpTools);
        updateStep(6, "completed", `Discovered ${testData.mcpTools.length} governed MCP tools`);
      } else {
        updateStep(6, "completed", `Connected (warning: ${testData.error || "no tools discovered"})`);
      }

      setIsProvisionComplete(true);
    } catch (err: any) {
      setProvisionError(err?.message || "Auto-provisioning failed");
      setProvisionSteps((prev) =>
        prev.map((s) => (s.status === "running" ? { ...s, status: "error", detail: err?.message } : s))
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, color: "var(--near-black-ink)", letterSpacing: "-0.03em" }}>
          Agent Onboarding Wizard
        </h1>
        <p style={{ fontSize: "14px", color: "var(--mid-warm-gray)", marginTop: "4px" }}>
          Provision an autonomous Hermes or OpenClaw operations sidecar with governed capabilities and real-time MCP bridge.
        </p>
      </div>

      {/* Stepper Container */}
      <AgentWizard
        currentStep={currentStep}
        steps={WIZARD_STEPS}
        onNext={handleNext}
        onBack={handleBack}
        canGoNext={
          currentStep === 0 ? inviteValidated :
          currentStep === 1 ? Boolean(basicInfo.name.trim()) : true
        }
        nextLabel={currentStep === 4 ? "Review Spec" : "Continue"}
        hideFooter={currentStep >= 5}
      >
        {currentStep === 0 && (
          <StepInvite
            inviteToken={inviteToken}
            onChange={(val) => {
              setInviteToken(val);
              if (inviteValidated) {
                setInviteValidated(false);
                setInviteData(null);
              }
            }}
            errors={basicErrors}
            validated={inviteValidated}
            inviteData={inviteData}
            onValidate={() => validateInviteToken()}
            onContinue={() => setCurrentStep(1)}
            isOperator={isOperator}
            loadingInvite={loadingInvite}
            onCreateInvite={handleCreateInvite}
          />
        )}

        {currentStep === 1 && (
          <StepBasic values={basicInfo} onChange={setBasicInfo} errors={basicErrors} />
        )}

        {currentStep === 2 && (
          <StepAdapter
            agentType={basicInfo.type}
            hermesConfig={hermesConfig}
            onHermesChange={setHermesConfig}
            openclawConfig={openclawConfig}
            onOpenclawChange={setOpenclawConfig}
            customConfig={customConfig}
            onCustomChange={setCustomConfig}
          />
        )}

        {currentStep === 3 && (
          <StepTrust
            preset={trustPreset}
            onPresetChange={setTrustPreset}
            selectedCapabilities={selectedCapabilities}
            onCapabilitiesChange={setSelectedCapabilities}
            capabilities={capabilities}
            loadingCapabilities={loadingCaps}
          />
        )}

        {currentStep === 4 && (
          <StepSkills
            skills={skills}
            selectedSkills={selectedSkills}
            onChange={setSelectedSkills}
            loading={loadingSkills}
          />
        )}

        {currentStep === 5 && (
          <StepReview
            basic={basicInfo}
            adapterType={basicInfo.type}
            hermesConfig={hermesConfig}
            openclawConfig={openclawConfig}
            customConfig={customConfig}
            trustPreset={trustPreset}
            selectedCapabilities={selectedCapabilities}
            selectedSkills={selectedSkills}
            allSkills={skills}
            submitting={submitting}
            onSubmit={handleStartProvisioning}
            onBack={() => setCurrentStep(4)}
          />
        )}

        {currentStep === 6 && (
          <StepProvision
            steps={provisionSteps}
            isComplete={isProvisionComplete}
            agentId={createdAgentId}
            mcpSseUrl={createdMcpSseUrl}
            connectorPid={createdConnectorPid}
            toolsDiscovered={discoveredTools}
            errorMessage={provisionError}
            onRetry={handleStartProvisioning}
          />
        )}
      </AgentWizard>
    </div>
  );
}
