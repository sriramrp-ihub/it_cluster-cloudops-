"use client";

import React, { useState } from "react";
import { useAgentChat } from "../../context/AgentChatContext";

export function OverviewChatComposer() {
  const { openChat } = useAgentChat();
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    openChat(query);
    setQuery("");
  };

  const handlePromptClick = (promptText: string) => {
    openChat(promptText);
  };

  return (
    <div className="harvey-card" style={{ padding: "24px 28px", border: "1px solid var(--warm-gray-border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", margin: "0 0 4px 0" }}>
            Operational Command
          </h2>
          <p className="body-subtle" style={{ margin: 0, fontSize: "13.5px" }}>
            Query infrastructure, active deployments, incident state, and cloud operations.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openChat()}
          className="btn-secondary"
          style={{ fontSize: "12px", padding: "4px 10px" }}
        >
          Expand Workspace
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px", position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Query operations... e.g. "Is starvision-motors healthy?"'
          className="form-input"
          style={{ flex: 1, padding: "12px 16px", fontSize: "14px" }}
        />
        <button
          type="submit"
          className="btn-primary"
          style={{ padding: "12px 24px", fontSize: "14px" }}
        >
          Send
        </button>
      </form>

      {/* Suggested Quick Prompts */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
        <span style={{ fontSize: "12px", color: "var(--mid-warm-gray)", alignSelf: "center", marginRight: "4px" }}>
          Suggested:
        </span>
        {[
          "Is starvision-motors healthy?",
          "Analyze recent activity for starvision-motors",
          "Give me a Fargate deployment checklist",
          "What changed in production recently?"
        ].map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => handlePromptClick(prompt)}
            style={{
              background: "#f7f6f4",
              border: "1px solid var(--warm-gray-border)",
              borderRadius: "var(--radius-sm)",
              padding: "4px 10px",
              fontSize: "12px",
              color: "var(--near-black-ink)",
              cursor: "pointer",
              transition: "all 0.15s ease"
            }}
          >
            "{prompt}"
          </button>
        ))}
      </div>
    </div>
  );
}
