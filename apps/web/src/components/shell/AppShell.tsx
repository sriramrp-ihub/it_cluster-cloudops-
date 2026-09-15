"use client";

import React from "react";
import { TopNav } from "./TopNav";
import { Footer } from "./Footer";
import { AuthGuard } from "../../auth/AuthGuard";
import { AgentChatProvider } from "../../context/AgentChatContext";
import { CloudOpsAgentChat } from "../agent/CloudOpsAgentChat";
import { AgentChatLauncher } from "../agent/AgentChatLauncher";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AgentChatProvider>
      <div className="app-shell">
        <TopNav />
        <AuthGuard>
          <main className="main-surface">{children}</main>
        </AuthGuard>
        <Footer />
        <CloudOpsAgentChat />
        <AgentChatLauncher />
      </div>
    </AgentChatProvider>
  );
}

