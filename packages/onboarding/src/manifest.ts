import type { JoinRequestRecord } from "./joinRequest.js";
import { InviteService } from "./invite.js";
import { JoinRequestRepository } from "./joinRequest.js";

export interface OnboardingManifest {
  onboardingVersion: string;
  tenantId: string;
  inviteState: "ACTIVE";
  lifecycleState: "INVITE_ACTIVE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  nextAction: "SUBMIT_JOIN_REQUEST" | "WAIT_FOR_APPROVAL" | "CLAIM_CREDENTIAL" | "NONE";
  joinRequestId?: string;
  agentId?: string;
  supportedAgentTypes: string[];
  endpoints: {
    join: string;
    claim: string;
    gatewayWs?: string;
    mcpSse?: string;
  };
  joinSchema: {
    type: "object";
    required: string[];
    properties: Record<string, unknown>;
  };
}

export class ManifestService {
  constructor(
    private readonly inviteService: InviteService = new InviteService(),
    private readonly joinRequestRepo: JoinRequestRepository = new JoinRequestRepository()
  ) {}

  /**
   * Resolve an invite token and return the machine-readable onboarding manifest.
   */
  async getManifest(rawToken: string): Promise<OnboardingManifest> {
    const invite = await this.inviteService.validateAndGetInvite(rawToken);
    const existingJoin = await this.joinRequestRepo.findActiveByInviteId(invite.id);

    let lifecycleState: "INVITE_ACTIVE" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" = "INVITE_ACTIVE";
    let nextAction: "SUBMIT_JOIN_REQUEST" | "WAIT_FOR_APPROVAL" | "CLAIM_CREDENTIAL" | "NONE" = "SUBMIT_JOIN_REQUEST";
    let joinRequestId: string | undefined = undefined;
    let agentId: string | undefined = undefined;

    if (existingJoin) {
      joinRequestId = existingJoin.id;
      if (existingJoin.status === "PENDING_APPROVAL") {
        lifecycleState = "PENDING_APPROVAL";
        nextAction = "WAIT_FOR_APPROVAL";
      } else if (existingJoin.status === "APPROVED") {
        lifecycleState = "APPROVED";
        nextAction = "CLAIM_CREDENTIAL";
        if (existingJoin.agentId) {
          agentId = existingJoin.agentId;
        }
      } else if (existingJoin.status === "REJECTED") {
        lifecycleState = "REJECTED";
        nextAction = "NONE";
      }
    }

    return {
      onboardingVersion: "1.0",
      tenantId: invite.tenantId,
      inviteState: "ACTIVE",
      lifecycleState,
      nextAction,
      ...(joinRequestId ? { joinRequestId } : {}),
      ...(agentId ? { agentId } : {}),
      supportedAgentTypes: ["hermes", "openclaw", "custom"],
      endpoints: {
        join: `/v1/onboarding/${rawToken}/join`,
        claim: "/v1/onboarding/claim",
        gatewayWs: "/v1/gateway/ws",
        mcpSse: "/v1/mcp/sse"
      },
      joinSchema: {
        type: "object",
        required: ["agent", "runtime"],
        properties: {
          agent: {
            type: "object",
            required: ["name", "type"],
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["hermes", "openclaw", "custom"] }
            }
          },
          runtime: {
            type: "object",
            required: ["name", "version"],
            properties: {
              name: { type: "string" },
              version: { type: "string" },
              protocol: { type: "string" },
              endpoint: { type: "string" }
            }
          },
          requestedCapabilities: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    };
  }
}
