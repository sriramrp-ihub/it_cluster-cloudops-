/**
 * CloudOps In-Memory AWS Session Manager
 * 
 * CRITICAL SECURITY INVARIANT:
 * Temporary STS credentials live STRICTLY in server memory.
 * They are NEVER written to PostgreSQL, disk, logs, browser storage,
 * or returned through HTTP responses.
 * 
 * Designed for downstream Tool Gateway consumption to execute authorized
 * cloud queries (ECS, CloudWatch, RDS) without ever exposing raw AWS credentials
 * to agent brains or WebSocket frames.
 */

export interface AwsSessionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  expiration?: Date | undefined;
}

export interface AwsActiveSession {
  cloudAccountId: string;
  tenantId: string;
  provider: "aws";
  accountId: string;
  region: string;
  roleArn?: string | null | undefined;
  credentials: AwsSessionCredentials;
  createdAt: Date;
}

export class AwsSessionManager {
  private sessions = new Map<string, AwsActiveSession>();

  private buildKey(tenantId: string, cloudAccountId: string): string {
    return `${tenantId}:${cloudAccountId}`;
  }

  /**
   * Store an authenticated AWS session in-memory.
   */
  createSession(
    tenantId: string,
    cloudAccountId: string,
    sessionData: Omit<AwsActiveSession, "tenantId" | "cloudAccountId" | "createdAt">
  ): AwsActiveSession {
    const key = this.buildKey(tenantId, cloudAccountId);
    const session: AwsActiveSession = {
      ...sessionData,
      tenantId,
      cloudAccountId,
      createdAt: new Date()
    };
    this.sessions.set(key, session);
    return session;
  }

  /**
   * Retrieve active session metadata (excluding secret keys when needed).
   */
  getSession(tenantId: string, cloudAccountId: string): AwsActiveSession | undefined {
    const key = this.buildKey(tenantId, cloudAccountId);
    const session = this.sessions.get(key);
    if (!session) return undefined;

    // Check expiration if applicable
    if (session.credentials.expiration && session.credentials.expiration.getTime() <= Date.now()) {
      this.sessions.delete(key);
      return undefined;
    }

    return session;
  }

  /**
   * Internal retrieval for Tool Gateway execution ONLY.
   * Returns temporary credentials to construct SDK client for a single tool call.
   */
  getCredentials(tenantId: string, cloudAccountId: string): AwsSessionCredentials | undefined {
    const session = this.getSession(tenantId, cloudAccountId);
    return session?.credentials;
  }

  /**
   * Check if a valid, non-expired session exists for the tenant and account.
   */
  hasValidSession(tenantId: string, cloudAccountId: string): boolean {
    return this.getSession(tenantId, cloudAccountId) !== undefined;
  }

  /**
   * Invalidate and delete an active session on disconnect or token expiration.
   */
  deleteSession(tenantId: string, cloudAccountId: string): boolean {
    const key = this.buildKey(tenantId, cloudAccountId);
    return this.sessions.delete(key);
  }

  invalidateSession(tenantId: string, cloudAccountId: string): boolean {
    return this.deleteSession(tenantId, cloudAccountId);
  }

  /**
   * Invalidate all active sessions for a specific tenant (e.g. tenant offboarding).
   */
  clearTenantSessions(tenantId: string): void {
    for (const [key, session] of this.sessions.entries()) {
      if (session.tenantId === tenantId) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Total count of active in-memory sessions (for diagnostics / testing).
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (used for test teardown).
   */
  clearAll(): void {
    this.sessions.clear();
  }
}

/**
 * Singleton instance used across the CloudOps backend process.
 */
export const defaultAwsSessionManager = new AwsSessionManager();
