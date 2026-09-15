"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  authAdapter,
  OperatorSession,
  TenantOption,
  OperatorOption
} from "./AuthAdapter";

interface OperatorContextType {
  session: OperatorSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  availableTenants: TenantOption[];
  availableOperators: OperatorOption[];
  login: (operatorId: string, tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (newTenantId: string) => Promise<void>;
}

const OperatorContext = createContext<OperatorContextType | undefined>(undefined);

export function OperatorProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [availableTenants, setAvailableTenants] = useState<TenantOption[]>([]);
  const [availableOperators, setAvailableOperators] = useState<OperatorOption[]>([]);
  const router = useRouter();
  const pathname = usePathname();

  const initAuth = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tenants, operators, current] = await Promise.all([
        authAdapter.getAvailableTenants(),
        authAdapter.getAvailableOperators(),
        authAdapter.getCurrentSession()
      ]);

      setAvailableTenants(tenants);
      setAvailableOperators(operators);

      if (current) {
        setSession(current);
      } else {
        // Automatically provide default dev session if not on /login to streamline dev experience
        const defaultTenant = tenants[0]?.id || "ten_default_tenant";
        const defaultOperator = operators[0]?.id || "op_admin_operator";
        const devSession = await authAdapter.authenticate({
          operatorId: defaultOperator,
          tenantId: defaultTenant
        });
        setSession(devSession);
      }
    } catch (err) {
      console.error("Failed to initialize operator session:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  const login = async (operatorId: string, tenantId: string) => {
    setIsLoading(true);
    try {
      const newSession = await authAdapter.authenticate({ operatorId, tenantId });
      setSession(newSession);
      router.push("/");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authAdapter.logout();
      setSession(null);
      router.push("/login");
    } finally {
      setIsLoading(false);
    }
  };

  const switchTenant = async (newTenantId: string) => {
    if (!session) return;
    setIsLoading(true);
    try {
      const updated = await authAdapter.switchTenant(newTenantId);
      setSession(updated);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <OperatorContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        availableTenants,
        availableOperators,
        login,
        logout,
        switchTenant
      }}
    >
      {children}
    </OperatorContext.Provider>
  );
}

export function useOperator(): OperatorContextType {
  const context = useContext(OperatorContext);
  if (!context) {
    throw new Error("useOperator must be used within an OperatorProvider");
  }
  return context;
}
