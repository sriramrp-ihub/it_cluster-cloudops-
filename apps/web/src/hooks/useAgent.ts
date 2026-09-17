"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAgent, connectAgent, testAgent, deleteAgent, AgentItem } from "../lib/api";
import { useOperator } from "../auth/OperatorContext";

export function useAgent(agentId: string) {
  const { session } = useOperator();
  const [agent, setAgent] = useState<AgentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  const tenantId = session?.tenantId;
  const operatorId = session?.operatorId;

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAgent(agentId, tenantId, operatorId);
      setAgent(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [agentId, tenantId, operatorId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConnect = async (autoApprove: boolean = true) => {
    if (!agentId) return null;
    setConnecting(true);
    setError(null);
    try {
      const res = await connectAgent(agentId, autoApprove, tenantId, operatorId);
      await load();
      return res;
    } catch (err: any) {
      setError(err?.message || "Failed to connect agent");
      throw err;
    } finally {
      setConnecting(false);
    }
  };

  const handleTest = async () => {
    if (!agentId) return null;
    setTesting(true);
    setError(null);
    try {
      const res = await testAgent(agentId, tenantId, operatorId);
      return res;
    } catch (err: any) {
      setError(err?.message || "Failed to test agent connection");
      throw err;
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!agentId) return null;
    return deleteAgent(agentId, tenantId, operatorId);
  };

  return {
    agent,
    loading,
    error,
    connecting,
    testing,
    refresh: load,
    connect: handleConnect,
    test: handleTest,
    delete: handleDelete
  };
}
