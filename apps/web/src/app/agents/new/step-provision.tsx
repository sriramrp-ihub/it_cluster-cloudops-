"use client";

import React from "react";
import { ProvisionProgress, ProvisionStep } from "../../../components/agents/ProvisionProgress";

interface StepProvisionProps {
  steps: ProvisionStep[];
  isComplete: boolean;
  agentId?: string;
  mcpSseUrl?: string;
  connectorPid?: number;
  toolsDiscovered?: string[];
  errorMessage?: string | null;
  onRetry: () => void;
}

export const StepProvision: React.FC<StepProvisionProps> = ({
  steps,
  isComplete,
  agentId,
  mcpSseUrl,
  connectorPid,
  toolsDiscovered,
  errorMessage,
  onRetry
}) => {
  return (
    <div>
      <ProvisionProgress
        steps={steps}
        isComplete={isComplete}
        agentId={agentId}
        mcpSseUrl={mcpSseUrl}
        connectorPid={connectorPid}
        toolsDiscovered={toolsDiscovered}
        errorMessage={errorMessage}
        onRetry={onRetry}
      />
    </div>
  );
};
