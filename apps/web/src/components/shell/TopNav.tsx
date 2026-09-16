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
          title="Search or query operations (⌘K)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Search or query operations...</span>
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
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </header>
  );
}

