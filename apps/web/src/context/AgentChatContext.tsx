"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  AgentOperationalContext,
  AgentChatMessage,
  agentClient,
  OperationalProgressStep
} from "../lib/agentClient";
import { useOperator } from "../auth/OperatorContext";

interface AgentChatContextType {
  isOpen: boolean;
  openChat: (initialPrompt?: string) => void;
  closeChat: () => void;
  toggleChat: () => void;
  context: AgentOperationalContext;
  setChatContext: (ctx: Partial<AgentOperationalContext>) => void;
  messages: AgentChatMessage[];
  sendMessage: (prompt: string) => Promise<void>;
  isWorking: boolean;
  currentSteps: OperationalProgressStep[];
  agentAvailable: boolean;
  connectedAgentsCount: number;
  refreshAgentStatus: () => Promise<void>;
}

const AgentChatContext = createContext<AgentChatContextType | undefined>(undefined);

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const { session } = useOperator();
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [connectedAgentsCount, setConnectedAgentsCount] = useState(0);
  const [currentSteps, setCurrentSteps] = useState<OperationalProgressStep[]>([]);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [context, setContextState] = useState<AgentOperationalContext>({
    environment: "Production",
    region: "us-east-1"
  });

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  const refreshAgentStatus = useCallback(async () => {
    const res = await agentClient.checkAgentStatus(tenantId, operatorId);
    setAgentAvailable(res.available);
    setConnectedAgentsCount(res.connectedCount);
  }, [tenantId, operatorId]);

  useEffect(() => {
    refreshAgentStatus();
  }, [refreshAgentStatus]);

  const setChatContext = useCallback((newCtx: Partial<AgentOperationalContext>) => {
    setContextState((prev) => ({
      ...prev,
      ...newCtx
    }));
  }, []);

  const openChat = useCallback((initialPrompt?: string) => {
    setIsOpen(true);
    if (initialPrompt) {
      setTimeout(() => {
        handleSendMessage(initialPrompt);
      }, 50);
    }
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Keyboard shortcut listener: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleChat();
      }
      if (e.key === "Escape" && isOpen) {
        closeChat();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, toggleChat, closeChat]);

  const handleSendMessage = async (prompt: string) => {
    if (!prompt.trim() || isWorking) return;

    const userMsg: AgentChatMessage = {
      id: `msg_user_${Date.now()}`,
      sender: "user",
      text: prompt.trim(),
      timestamp: new Date().toISOString(),
      status: "done"
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsWorking(true);
    setCurrentSteps([]);

    try {
      const response = await agentClient.executeQuery(
        prompt.trim(),
        context,
        (step) => {
          setCurrentSteps((prev) => [...prev, step]);
        }
      );

      setMessages((prev) => [...prev, response]);
    } catch (err: any) {
      const errorMsg: AgentChatMessage = {
        id: `msg_err_${Date.now()}`,
        sender: "agent",
        text: `Operational query failed: ${err.message || "Unknown error"}`,
        timestamp: new Date().toISOString(),
        status: "error"
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsWorking(false);
      setCurrentSteps([]);
    }
  };

  return (
    <AgentChatContext.Provider
      value={{
        isOpen,
        openChat,
        closeChat,
        toggleChat,
        context,
        setChatContext,
        messages,
        sendMessage: handleSendMessage,
        isWorking,
        currentSteps,
        agentAvailable,
        connectedAgentsCount,
        refreshAgentStatus
      }}
    >
      {children}
    </AgentChatContext.Provider>
  );
}

export function useAgentChat() {
  const ctx = useContext(AgentChatContext);
  if (!ctx) {
    throw new Error("useAgentChat must be used within an AgentChatProvider");
  }
  return ctx;
}
