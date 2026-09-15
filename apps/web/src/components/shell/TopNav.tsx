"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TenantSwitcher } from "./TenantSwitcher";
import { OperatorBadge } from "./OperatorBadge";
import { useAgentChat } from "../../context/AgentChatContext";

export function TopNav() {
  const pathname = usePathname();
  const { openChat, agentAvailable } = useAgentChat();

  // Minimal header for unauthenticated login screen
  if (pathname === "/login") {
    return (
      <header className="top-nav">
        <div className="brand-container">
          <div className="brand-badge-icon">CO</div>
          <span className="brand-title">CloudOps</span>
          <span className="brand-tag">Operations</span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted-gray)" }}>
          DevOps Control Plane
        </div>
      </header>
    );
  }

  const isOverview = pathname === "/";
  const isInfrastructure = pathname.startsWith("/infrastructure") || pathname.startsWith("/cloud");
  const isInvestigate = pathname.startsWith("/investigate");
  const isAgents = pathname.startsWith("/agents");
  const isApprovals = pathname.startsWith("/approvals");

  return (
    <header className="top-nav">
      {/* 1. Brand */}
      <div className="brand-container">
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className="brand-badge-icon">CO</div>
          <span className="brand-title">CloudOps</span>
        </Link>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "#a8a29e",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid #2e2c28"
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: agentAvailable ? "#22c55e" : "#eab308"
            }}
          />
          <span>Production</span>
        </span>
      </div>

      {/* 2. Central Agent Prompt Search Trigger */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 1.5rem" }}>
        <button
          type="button"
          onClick={() => openChat()}
          className="global-search-trigger"
          title="Ask CloudOps anything (⌘K)"
        >
          <span>🔍</span>
          <span>Ask CloudOps anything...</span>
          <span className="kbd-hint">⌘K</span>
        </button>
      </div>

      {/* 3. Primary Navigation Menu */}
      <nav className="nav-menu">
        <Link href="/" className={`nav-item ${isOverview ? "active" : ""}`}>
          Overview
        </Link>

        <Link
          href="/infrastructure"
          className={`nav-item ${isInfrastructure ? "active" : ""}`}
        >
          Infrastructure
        </Link>

        <Link
          href="/investigate"
          className={`nav-item ${isInvestigate ? "active" : ""}`}
        >
          Investigations
        </Link>

        <Link
          href="/agents"
          className={`nav-item ${isAgents ? "active" : ""}`}
        >
          Agents
        </Link>

        <Link
          href="/approvals"
          className={`nav-item ${isApprovals ? "active" : ""}`}
        >
          Approvals
        </Link>
      </nav>

      {/* 4. Meta & Tenant/Operator Actions */}
      <div className="nav-meta-actions">
        <TenantSwitcher />
        <OperatorBadge />
        <Link
          href="/settings"
          title="Settings"
          style={{
            color: "var(--muted-gray)",
            fontSize: "15px",
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            display: "inline-flex",
            alignItems: "center"
          }}
        >
          ⚙
        </Link>
      </div>
    </header>
  );
}

