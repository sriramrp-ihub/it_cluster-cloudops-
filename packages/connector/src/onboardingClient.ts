import type { OnboardingManifest, JoinRequestRecord, ClaimCredentialResult } from "@cloudops/onboarding";

export interface JoinRequestPayload {
  agent: {
    name: string;
    type: string;
  };
  runtime: {
    name: string;
    version: string;
    protocol?: string | undefined;
    endpoint?: string | undefined;
  };
  requestedCapabilities?: string[] | undefined;
}

export interface JoinRequestResponse {
  joinRequestId: string;
  status: "PENDING_APPROVAL";
  tenantId: string;
  requestedCapabilities: string[];
}

export class OnboardingClient {
  constructor(private readonly apiBaseUrl: string) {
    // Strip trailing slash
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
  }

  /**
   * Retrieve machine-readable onboarding manifest using invite token.
   */
  async getManifest(inviteToken: string): Promise<OnboardingManifest> {
    const url = `${this.apiBaseUrl}/v1/onboarding/${encodeURIComponent(inviteToken)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });
    } catch (err: any) {
      throw new Error(`Failed to reach onboarding endpoint: ${err.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Onboarding manifest request failed with status ${res.status}: ${errText}`);
    }

    return (await res.json()) as OnboardingManifest;
  }

  /**
   * Submit declarative join request proposing capabilities.
   */
  async submitJoin(inviteToken: string, payload: JoinRequestPayload): Promise<JoinRequestResponse> {
    const url = `${this.apiBaseUrl}/v1/onboarding/${encodeURIComponent(inviteToken)}/join`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (err: any) {
      throw new Error(`Failed to submit join request: ${err.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Join request submission failed with status ${res.status}: ${errText}`);
    }

    return (await res.json()) as JoinRequestResponse;
  }

  /**
   * Poll manifest endpoint until operator approval is granted.
   */
  async pollForApproval(
    inviteToken: string,
    options: { intervalMs?: number; timeoutMs?: number; onPoll?: (manifest: OnboardingManifest) => void } = {}
  ): Promise<OnboardingManifest> {
    const intervalMs = options.intervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 120000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const manifest = await this.getManifest(inviteToken);
      if (options.onPoll) {
        options.onPoll(manifest);
      }

      if (manifest.lifecycleState === "APPROVED") {
        return manifest;
      }

      if (manifest.lifecycleState === "REJECTED") {
        throw new Error("Join request was rejected by operator");
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timeout waiting for operator approval after ${timeoutMs}ms`);
  }

  /**
   * Atomically claim one-time bootstrap credential after approval.
   */
  async claimCredential(inviteToken: string, joinRequestId: string): Promise<ClaimCredentialResult> {
    const url = `${this.apiBaseUrl}/v1/onboarding/claim`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          inviteToken,
          joinRequestId
        })
      });
    } catch (err: any) {
      throw new Error(`Failed to claim credential: ${err.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Credential claim failed with status ${res.status}: ${errText}`);
    }

    return (await res.json()) as ClaimCredentialResult;
  }
}
