"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";
import { StructuredAgentCard } from "../../lib/agentClient";

export function CloudOpsAgentChat() {
  const {
    isOpen,
    closeChat,
    context,
    messages,
    sendMessage,
    isWorking,
    currentSteps,
    agentAvailable,
    connectedAgentsCount
  } = useAgentChat();

  const [inputVal, setInputVal] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSteps, isWorking]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || isWorking) return;
    sendMessage(inputVal);
    setInputVal("");
  };

  const handleSelectPrompt = (promptText: string) => {
    sendMessage(promptText);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="agent-drawer-backdrop" onClick={closeChat} />

      {/* Right-Side Drawer Panel */}
      <aside className="agent-chat-panel" aria-label="CloudOps Agent Operations Drawer">
        {/* Header */}
        <div className="agent-chat-header">
          <div className="agent-brand">
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "var(--radius-sm)",
                background: "#ffffff",
                color: "var(--near-black-ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "12px"
              }}
            >
              CO
            </div>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>CloudOps Agent</span>
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: agentAvailable ? "#22c55e" : "#eab308"
                  }}
                  title={agentAvailable ? "Agent Fleet Connected" : "Agent Offline / Standby"}
                />
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
                {connectedAgentsCount > 0 ? `${connectedAgentsCount} Agent Connected` : "Autonomous Control Surface"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Dynamic Context Tag */}
            <div className="context-pill" title="Operational context automatically inherited from current view">
              {context.service
                ? `Service: ${context.service}`
                : context.investigationId
                ? `Investigation: ${context.investigationId}`
                : `${context.environment || "Production"} · ${context.region || "us-east-1"}`}
            </div>

            <button
              onClick={closeChat}
              className="agent-chat-close-btn"
              title="Close drawer (Esc)"
              aria-label="Close drawer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="agent-chat-body">
          {messages.length === 0 ? (
            <div>
              <div style={{ padding: "8px 0 16px 0", borderBottom: "1px solid var(--warm-gray-border)", marginBottom: "16px" }}>
                <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", marginBottom: "4px" }}>
                  Ask CloudOps anything
                </h3>
                <p className="body-subtle" style={{ fontSize: "13px" }}>
                  Ask questions about deployments, investigate service incidents, check infrastructure health, or verify readiness.
                </p>
              </div>

              {!agentAvailable && (
                <div className="alert-banner warning" style={{ marginBottom: "16px", padding: "10px 14px", fontSize: "12.5px" }}>
                  <div>
                    <strong style={{ color: "var(--near-black-ink)" }}>Agent Daemon Offline:</strong> Operational requests will report real status. Connect an agent in{" "}
                    <Link href="/agents/add" onClick={closeChat} style={{ textDecoration: "underline", fontWeight: 600 }}>
                      Agents
                    </Link>{" "}
                    to dispatch live tasks.
                  </div>
                </div>
              )}

              {/* Suggested Prompts */}
              <div className="suggested-prompts-container">
                <div className="suggested-prompt-category">Health & Outages</div>
                <button
                  type="button"
                  onClick={() => handleSelectPrompt("What services are unhealthy?")}
                  className="suggested-prompt-btn"
                >
                  <span>"What services are unhealthy?"</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow"><polyline points="9 18 15 12 9 6" /></svg>
                </button>

                <div className="suggested-prompt-category">Deployments & Readiness</div>
                <button
                  type="button"
                  onClick={() => handleSelectPrompt("Give me a Fargate deployment checklist.")}
                  className="suggested-prompt-btn"
                >
                  <span>"Give me a Fargate deployment checklist."</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow"><polyline points="9 18 15 12 9 6" /></svg>
                </button>

                <div className="suggested-prompt-category">Investigation</div>
                <button
                  type="button"
                  onClick={() => handleSelectPrompt("Is starvision-motors healthy?")}
                  className="suggested-prompt-btn"
                >
                  <span>"Is starvision-motors healthy?"</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow"><polyline points="9 18 15 12 9 6" /></svg>
                </button>

                <div className="suggested-prompt-category">Operations & Changes</div>
                <button
                  type="button"
                  onClick={() => handleSelectPrompt("What changed in production recently?")}
                  className="suggested-prompt-btn"
                >
                  <span>"What changed in production recently?"</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow"><polyline points="9 18 15 12 9 6" /></svg>
                </button>

                <div className="suggested-prompt-category">Security & Compliance</div>
                <button
                  type="button"
                  onClick={() => handleSelectPrompt("Find production resources with public access.")}
                  className="suggested-prompt-btn"
                >
                  <span>"Find production resources with public access."</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="arrow"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div key={msg.id} className={`chat-message-row ${msg.sender}`}>
                  <div className="chat-message-sender">
                    {msg.sender === "user" ? "You" : "CloudOps Agent"}
                  </div>

                  <div className={msg.sender === "user" ? "chat-bubble-user" : "chat-bubble-agent"}>
                    <p style={{ margin: 0 }}>{msg.text}</p>

                    {/* Structured Result Cards */}
                    {msg.structuredCard && (
                      <StructuredCardView card={msg.structuredCard} onCloseDrawer={closeChat} />
                    )}
                  </div>
                </div>
              ))}

              {/* In-Flight Operational Progress Steps */}
              {isWorking && (
                <div className="operational-progress-box">
                  <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--mid-warm-gray)", letterSpacing: "0.5px" }}>
                    Operational Progress
                  </div>
                  {currentSteps.length === 0 ? (
                    <div className="operational-step active">
                      <span className="pulse-dot" />
                      <span>Dispatching inquiry to CloudOps control plane...</span>
                    </div>
                  ) : (
                    currentSteps.map((step) => (
                      <div key={step.id} className={`operational-step ${step.status === "completed" ? "done" : "active"}`}>
                        <span style={{ fontSize: "11px", fontWeight: 600 }}>{step.status === "completed" ? "Done:" : "Active:"}</span>
                        <span>{step.label}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Footer */}
        <div className="agent-chat-footer">
          <form onSubmit={handleSubmit} className="agent-chat-form">
            <input
              ref={inputRef}
              type="text"
              placeholder={context.service ? `Ask about ${context.service}...` : "Ask CloudOps anything..."}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="agent-chat-input"
              disabled={isWorking}
            />
            <button
              type="submit"
              disabled={!inputVal.trim() || isWorking}
              className="btn-primary"
              style={{ padding: "0 18px", fontSize: "13px" }}
            >
              Send
            </button>
          </form>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", fontSize: "11px", color: "var(--muted-gray)" }}>
            <span>Bounded operational queries</span>
            <span>Press <code className="code-inline" style={{ fontSize: "10px" }}>Esc</code> to close</span>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * Structured Operational Card Component
 */
function StructuredCardView({ card, onCloseDrawer }: { card: StructuredAgentCard; onCloseDrawer: () => void }) {
  if (card.type === "health") {
    return (
      <div className="structured-card">
        <div className="structured-card-tag">SERVICE HEALTH</div>
        <div className="structured-card-title">
          <span>{card.service}</span>
          <span className="status-pill connected" style={{ fontSize: "10.5px" }}>
            <span className="status-dot-inner" />
            {card.status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", margin: "10px 0", textAlign: "center" }}>
          <div style={{ padding: "8px", background: "#f7f6f4", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "10px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Tasks</div>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>{card.tasksRunning} / {card.tasksDesired}</div>
          </div>
          <div style={{ padding: "8px", background: "#f7f6f4", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "10px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>CPU</div>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>{card.cpuPercent}%</div>
          </div>
          <div style={{ padding: "8px", background: "#f7f6f4", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "10px", color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>Memory</div>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>{card.memoryPercent}%</div>
          </div>
        </div>

        {card.message && (
          <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", marginBottom: "10px" }}>{card.message}</p>
        )}

        <Link
          href={`/infrastructure/${card.service}`}
          onClick={onCloseDrawer}
          className="btn-secondary"
          style={{ width: "100%", fontSize: "12px", justifyContent: "center" }}
        >
          View Service Dossier
        </Link>
      </div>
    );
  }

  if (card.type === "investigation") {
    return (
      <div className="structured-card">
        <div className="structured-card-tag">INVESTIGATION FINDING</div>
        <div className="structured-card-title">
          <span>{card.service}</span>
          <span style={{ fontSize: "12px", color: "#d97706", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            {card.confidence}% Confidence
          </span>
        </div>

        <div style={{ margin: "8px 0" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
            Likely Cause
          </div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "2px" }}>
            {card.cause}
          </div>
        </div>

        <div style={{ margin: "10px 0" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase", marginBottom: "4px" }}>
            Evidence Correlated
          </div>
          <ul style={{ paddingLeft: "18px", fontSize: "12px", color: "var(--mid-warm-gray)", display: "flex", flexDirection: "column", gap: "4px" }}>
            {card.evidence.map((ev, i) => (
              <li key={i}>{ev}</li>
            ))}
          </ul>
        </div>

        <div style={{ padding: "8px 10px", background: "#faf9f7", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)", fontSize: "12px", color: "var(--near-black-ink)", margin: "10px 0" }}>
          <strong>Remediation:</strong> {card.finding}
        </div>

        <Link
          href="/investigate"
          onClick={onCloseDrawer}
          className="btn-secondary"
          style={{ width: "100%", fontSize: "12px", justifyContent: "center" }}
        >
          View Full Evidence & Timeline
        </Link>
      </div>
    );
  }

  if (card.type === "checklist") {
    return (
      <div className="structured-card">
        <div className="structured-card-tag">DEPLOYMENT READINESS</div>
        <div className="structured-card-title">
          <span>{card.service}</span>
        </div>

        <div style={{ margin: "10px 0" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#16a34a", textTransform: "uppercase", marginBottom: "6px" }}>
            Automatically Verified ({card.automatedChecks.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
            {card.automatedChecks.map((chk, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>•</span>
                <span>{chk}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ margin: "12px 0 8px 0" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#d97706", textTransform: "uppercase", marginBottom: "6px" }}>
            Requires Manual Verification ({card.manualChecks.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
            {card.manualChecks.map((chk, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ color: "#d97706", fontWeight: 700 }}>•</span>
                <span>{chk}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "12px", padding: "8px 10px", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "var(--radius-sm)", fontSize: "11.5px", fontWeight: 600, color: "#92400e", textAlign: "center" }}>
          {card.status}
        </div>
      </div>
    );
  }

  if (card.type === "mutation_approval") {
    return (
      <div className="structured-card" style={{ borderLeft: "3px solid #d97706" }}>
        <div className="structured-card-tag" style={{ color: "#d97706" }}>ACTION REQUIRES APPROVAL</div>
        <div className="structured-card-title">
          <span>{card.action}</span>
          <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 6px", borderRadius: "var(--radius-sm)", fontWeight: 700 }}>
            GOVERNANCE
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "12.5px" }}>
          <span style={{ color: "var(--mid-warm-gray)" }}>Target Service:</span>
          <strong>{card.service}</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: "12.5px" }}>
          <span style={{ color: "var(--mid-warm-gray)" }}>Scaling Change:</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>{card.currentValue} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg> <strong>{card.requestedValue} tasks</strong></span>
        </div>

        <div style={{ padding: "8px 0", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
          <div><strong>Impact:</strong> {card.impact}</div>
          <div style={{ marginTop: "2px" }}><strong>Reason:</strong> {card.reason}</div>
        </div>

        <div style={{ marginTop: "10px" }}>
          <Link
            href="/approvals"
            onClick={onCloseDrawer}
            className="btn-primary"
            style={{ width: "100%", fontSize: "12px", justifyContent: "center" }}
          >
            Review in Approvals Queue
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
