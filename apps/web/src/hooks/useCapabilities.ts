"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchCapabilities, CapabilityItem } from "../lib/api";
import { useOperator } from "../auth/OperatorContext";

export function useCapabilities() {
  const { session } = useOperator();
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenantId = session?.tenantId;
  const operatorId = session?.operatorId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCapabilities(tenantId, operatorId);
      setCapabilities(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load capabilities");
    } finally {
      setLoading(false);
    }
  }, [tenantId, operatorId]);

  useEffect(() => {
    load();
  }, [load]);

  const filterByTier = (tier: "read" | "mutate" | "deploy") => {
    return capabilities.filter((c) => c.tier === tier);
  };

  const filterByCategory = (category: string) => {
    return capabilities.filter((c) => c.category === category);
  };

  return {
    capabilities,
    loading,
    error,
    refresh: load,
    filterByTier,
    filterByCategory
  };
}
