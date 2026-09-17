"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchSkills, SkillItem } from "../lib/api";
import { useOperator } from "../auth/OperatorContext";

export function useSkills() {
  const { session } = useOperator();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tenantId = session?.tenantId;
  const operatorId = session?.operatorId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSkills(tenantId, operatorId);
      setSkills(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, [tenantId, operatorId]);

  useEffect(() => {
    load();
  }, [load]);

  const builtInSkills = skills.filter((s) => s.builtIn);
  const companySkills = skills.filter((s) => !s.builtIn);

  return {
    skills,
    builtInSkills,
    companySkills,
    loading,
    error,
    refresh: load
  };
}
