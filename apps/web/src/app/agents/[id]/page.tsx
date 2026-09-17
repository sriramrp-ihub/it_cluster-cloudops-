"use client";

import React, { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useAgent } from "../../../hooks/useAgent";
import { useCapabilities } from "../../../hooks/useCapabilities";
import { useSkills } from "../../../hooks/useSkills";
import { AgentDetailHeader } from "../../../components/agents/AgentDetailHeader";
import { TestAgentModal } from "../../../components/agents/TestAgentModal";
import { OverviewTab } from "./tabs/overview";
import { ConfigTab } from "./tabs/config";
import { ActivityTab } from "./tabs/activity";
import { SkillsTab } from "./tabs/skills";
import { LogsTab } from "./tabs/logs";
import { useAgentChat } from "../../../context/AgentChatContext";

type TabType = "overview" | "configuration" | "activity" | "skills" | "logs";

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const { agent, loading, error, connecting, connect, delete: deleteAgent } = useAgent(id);
  const { capabilities } = useCapabilities();
  const { skills } = useSkills();
  const { setChatContext } = useAgentChat();

  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [showTestModal, setShowTestModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (agent) {
      setChatContext({
        agentId: agent.id,
        sourcePage: `Agent: ${agent.name}`
      });
    }
  }, [agent, setChatContext]);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteAgent();
      router.push("/agents");
    } catch {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "4rem 2rem", textAlign: "center", color: "var(--mid-warm-gray)" }}>
        Loading agent dossier...
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <h3 style={{ color: "#dc2626", marginBottom: "0.5rem" }}>Agent Not Found</h3>
        <p style={{ color: "var(--mid-warm-gray)", marginBottom: "1.5rem" }}>
          {error || `Agent with ID '${id}' does not exist or has been deleted.`}
        </p>
        <button
          type="button"
          onClick={() => router.push("/agents")}
          style={{
            padding: "8px 18px",
            backgroundColor: "var(--near-black-ink)",
            color: "#ffffff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: 600
          }}
        >
          &larr; Back to Fleet
        </button>
      </div>
    );
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "configuration", label: "Configuration" },
    { id: "activity", label: "Activity" },
    { id: "skills", label: "Skills" },
    { id: "logs", label: "Logs" }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Standardized Header */}
      <AgentDetailHeader
        agent={agent}
        onOpenTest={() => setShowTestModal(true)}
        onConnect={async () => {
          await connect(true);
        }}
        onDelete={() => setShowDeleteModal(true)}
        connecting={connecting}
      />

      {/* 2. Navigation Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: "2px"
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--near-black-ink)" : "var(--mid-warm-gray)",
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid var(--near-black-ink)" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 0.1s ease"
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 3. Active Tab Content */}
      <div>
        {activeTab === "overview" && (
          <OverviewTab
            agent={agent}
            capabilitiesCount={capabilities.length}
            skillsCount={skills.length}
          />
        )}

        {activeTab === "configuration" && (
          <ConfigTab agent={agent} capabilities={capabilities} />
        )}

        {activeTab === "activity" && <ActivityTab agentId={agent.id} />}

        {activeTab === "skills" && <SkillsTab skills={skills} />}

        {activeTab === "logs" && <LogsTab agentId={agent.id} />}
      </div>

      {/* Test Agent Modal */}
      <TestAgentModal
        agentId={agent.id}
        agentName={agent.name}
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 14, 13, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000
          }}
        >
          <div
            style={{
              maxWidth: "420px",
              padding: "1.75rem",
              backgroundColor: "var(--pure-white)",
              borderRadius: "8px",
              border: "1px solid var(--warm-gray-border)"
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "8px" }}>
              Delete Agent &apos;{agent.name}&apos;?
            </h3>
            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: "1.45", marginBottom: "1.25rem" }}>
              This will permanently terminate the active connector sidecar process, revoke bootstrap credentials, and delete the agent record.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                style={{
                  padding: "6px 14px",
                  fontSize: "13px",
                  borderRadius: "4px",
                  border: "1px solid var(--warm-gray-border)",
                  backgroundColor: "#ffffff",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                style={{
                  padding: "6px 16px",
                  fontSize: "13px",
                  borderRadius: "4px",
                  border: "none",
                  backgroundColor: "#dc2626",
                  color: "#ffffff",
                  cursor: isDeleting ? "not-allowed" : "pointer",
                  fontWeight: 600
                }}
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
