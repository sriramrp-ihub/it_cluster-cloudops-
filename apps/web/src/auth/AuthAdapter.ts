/**
 * CloudOps Authentication Adapter Architecture
 * Provides a clean boundary separating operational UI workflows from underlying auth implementations.
 * Currently backed by DevAuthAdapter, with zero page changes needed when enterprise OIDC/SSO lands.
 */

export interface OperatorSession {
  operatorId: string;
  operatorName: string;
  operatorRole: "admin" | "security_officer" | "platform_engineer" | "auditor";
  tenantId: string;
  tenantName: string;
  authenticatedAt: string;
  expiresAt: string;
}

export interface TenantOption {
  id: string;
  name: string;
  environment: string;
}

export interface OperatorOption {
  id: string;
  name: string;
  role: "admin" | "security_officer" | "platform_engineer" | "auditor";
  email: string;
}

export interface IAuthAdapter {
  authenticate(credentials: { operatorId: string; tenantId: string }): Promise<OperatorSession>;
  getCurrentSession(): Promise<OperatorSession | null>;
  logout(): Promise<void>;
  getAvailableTenants(): Promise<TenantOption[]>;
  getAvailableOperators(): Promise<OperatorOption[]>;
  switchTenant(newTenantId: string): Promise<OperatorSession>;
}

const SESSION_STORAGE_KEY = "cloudops_operator_session";

export class DevAuthAdapter implements IAuthAdapter {
  private inMemorySession: OperatorSession | null = null;

  private readonly availableTenants: TenantOption[] = [
    { id: "ten_default_tenant", name: "Primary Operations Tenant", environment: "Production / Control Plane" },
    { id: "ten_staging_tenant", name: "Staging Infrastructure Tenant", environment: "Pre-production" }
  ];

  private readonly availableOperators: OperatorOption[] = [
    {
      id: "op_admin_operator",
      name: "Alex Vance",
      role: "admin",
      email: "alex.vance@cloudops.internal"
    },
    {
      id: "op_secops_officer",
      name: "Elena Rostova",
      role: "security_officer",
      email: "elena.rostova@cloudops.internal"
    },
    {
      id: "op_platform_engineer",
      name: "Marcus Brody",
      role: "platform_engineer",
      email: "marcus.brody@cloudops.internal"
    }
  ];

  async getAvailableTenants(): Promise<TenantOption[]> {
    return this.availableTenants;
  }

  async getAvailableOperators(): Promise<OperatorOption[]> {
    return this.availableOperators;
  }

  async authenticate(credentials: { operatorId: string; tenantId: string }): Promise<OperatorSession> {
    const operator = this.availableOperators.find((o) => o.id === credentials.operatorId) || {
      id: credentials.operatorId,
      name: "Authorized Operator",
      role: "admin" as const,
      email: "operator@cloudops.internal"
    };

    const tenant = this.availableTenants.find((t) => t.id === credentials.tenantId) || {
      id: credentials.tenantId,
      name: "Target Tenant",
      environment: "Dedicated"
    };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 8-hour operational shift TTL

    const session: OperatorSession = {
      operatorId: operator.id,
      operatorName: operator.name,
      operatorRole: operator.role,
      tenantId: tenant.id,
      tenantName: tenant.name,
      authenticatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    this.inMemorySession = session;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } catch {
        // Fallback gracefully in restricted environments
      }
    }

    return session;
  }

  async getCurrentSession(): Promise<OperatorSession | null> {
    if (this.inMemorySession) {
      // Verify session expiry
      if (new Date(this.inMemorySession.expiresAt).getTime() > Date.now()) {
        return this.inMemorySession;
      }
      await this.logout();
      return null;
    }

    if (typeof window !== "undefined") {
      try {
        const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as OperatorSession;
          if (new Date(parsed.expiresAt).getTime() > Date.now()) {
            this.inMemorySession = parsed;
            return parsed;
          }
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  async switchTenant(newTenantId: string): Promise<OperatorSession> {
    const current = await this.getCurrentSession();
    if (!current) {
      throw new Error("Cannot switch tenant without an active authenticated session");
    }

    const tenant = this.availableTenants.find((t) => t.id === newTenantId) || {
      id: newTenantId,
      name: newTenantId,
      environment: "Active"
    };

    const updated: OperatorSession = {
      ...current,
      tenantId: tenant.id,
      tenantName: tenant.name
    };

    this.inMemorySession = updated;
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
    }

    return updated;
  }

  async logout(): Promise<void> {
    this.inMemorySession = null;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }
}

export const authAdapter: IAuthAdapter = new DevAuthAdapter();
