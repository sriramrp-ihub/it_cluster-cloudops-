"use client";

import React from "react";
import { useAgentChat } from "../../context/AgentChatContext";

export function AgentChatLauncher() {
  const { toggleChat, agentAvailable } = useAgentChat();

  return (
    <button
      type="button"
      onClick={toggleChat}
      className="agent-chat-floating-launcher"
      title="Open CloudOps Agent (⌘K)"
      aria-label="Open CloudOps Agent"
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          backgroundColor: agentAvailable ? "#22c55e" : "#eab308",
          boxShadow: agentAvailable ? "0 0 6px #22c55e" : "none"
        }}
      />
      <span>Ask CloudOps</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          background: "rgba(255, 255, 255, 0.15)",
          padding: "1px 5px",
          borderRadius: "3px"
        }}
      >
        ⌘K
      </span>
    </button>
  );
}
