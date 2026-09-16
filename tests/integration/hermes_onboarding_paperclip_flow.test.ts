import { describe, it, expect, beforeEach } from "vitest";
import {
  InviteService,
  JoinRequestService,
  ClaimService
} from "../../packages/onboarding/src/index.js";
import { getDatabase } from "@cloudops/database";
import { ConflictError } from "@cloudops/shared";

describe("Hermes Paperclip Onboarding Flow (Invite -> Declare -> Human Review -> Claim)", () => {
  const db = getDatabase();
  const tenantId = "ten_default_tenant";
  const operatorId = "op_admin_operator";

  let inviteService: InviteService;
  let joinRequestService: JoinRequestService;
  let claimService: ClaimService;

  beforeEach(() => {
    inviteService = new InviteService();
    joinRequestService = new JoinRequestService();
    claimService = new ClaimService();
  });

  it("visibly flags and rejects a join request requesting over-broad capability scope (e.g. deploy access)", async () => {
    // 1. Generate single-use signed invite for Hermes
    const invite = await inviteService.createInvite(tenantId, operatorId, 86400, {
      agentName: "hermes-local",
      agentType: "hermes",
      instructions: "Investigate AWS ECS incidents under read-only boundaries"
    });

    expect(invite.id).toBeDefined();
    expect(invite.inviteToken).toMatch(/^co_inv_/);
    expect(invite.onboardingPrompt).toContain("CLOUDOPS AGENT ONBOARDING INSTRUCTIONS");

    // 2. Hermes submits join request declaring over-broad capabilities (deploy-tier)
    const joinReq = await joinRequestService.submitJoinRequest(invite.inviteToken, {
      agent: {
        name: "hermes-unrestricted",
        type: "hermes"
      },
      runtime: {
        name: "hermes-agent",
        version: "0.2.0",
        protocol: "acp",
        endpoint: "http://127.0.0.1:8080"
      },
      requestedCapabilities: ["ecs.describe", "cloudwatch.read", "cluster.deploy", "iam.escalate"]
    });

    expect(joinReq.status).toBe("PENDING_APPROVAL");

    // 3. Human reviewer inspects declared capabilities from the queue
    const pendingReq = await joinRequestService.getJoinRequest(tenantId, joinReq.joinRequestId);
    expect(pendingReq.declaredCapabilities).toContain("cluster.deploy");
    expect(pendingReq.declaredCapabilities).toContain("iam.escalate");

    // Human operator explicitly rejects due to over-broad capabilities
    await joinRequestService.rejectJoinRequest(
      tenantId,
      joinReq.joinRequestId,
      operatorId,
      "REJECTED: Over-broad scope requested ('cluster.deploy', 'iam.escalate'). Investigation agents only permitted read-only capabilities."
    );

    const rejectedReq = await joinRequestService.getJoinRequest(tenantId, joinReq.joinRequestId);
    expect(rejectedReq.status).toBe("REJECTED");
    expect(rejectedReq.rejectionReason).toContain("Over-broad scope requested");

    // 4. Verify agent CANNOT claim credentials
    await expect(
      claimService.claimBootstrapCredential({
        inviteToken: invite.inviteToken,
        joinRequestId: joinReq.joinRequestId
      })
    ).rejects.toThrow(ConflictError);
  });

  it("successfully completes invite -> join request -> human approval -> scoped single-use claim", async () => {
    // 1. Operator creates invite
    const invite = await inviteService.createInvite(tenantId, operatorId, 86400, {
      agentName: "hermes-sre",
      agentType: "hermes"
    });

    // 2. Hermes submits properly scoped join request
    const joinReq = await joinRequestService.submitJoinRequest(invite.inviteToken, {
      agent: {
        name: "hermes-sre-prod",
        type: "hermes"
      },
      runtime: {
        name: "hermes-agent",
        version: "0.2.0",
        protocol: "acp",
        endpoint: "http://127.0.0.1:8080"
      },
      requestedCapabilities: ["ecs.describe", "cloudwatch.read"]
    });

    // 3. Human explicitly approves the join request
    const approval = await joinRequestService.approveJoinRequest(
      tenantId,
      joinReq.joinRequestId,
      operatorId
    );

    expect(approval.status).toBe("APPROVED");
    expect(approval.agentId).toMatch(/^ag_/);

    // Verify Agent row created with APPROVED status (NOT Connected!)
    const agentRow = await db
      .selectFrom("agents")
      .selectAll()
      .where("id", "=", approval.agentId)
      .executeTakeFirstOrThrow();
    expect(agentRow.status).toBe("APPROVED");

    // 4. Hermes claims single-use short-lived credential
    const claim = await claimService.claimBootstrapCredential({
      inviteToken: invite.inviteToken,
      joinRequestId: joinReq.joinRequestId
    });

    expect(claim.agentId).toBe(approval.agentId);
    expect(claim.claimCredential).toMatch(/^co_agent_/);
    expect(claim.status).toBe("CLAIMED");

    // 5. Replay protection: second claim attempt fails
    await expect(
      claimService.claimBootstrapCredential({
        inviteToken: invite.inviteToken,
        joinRequestId: joinReq.joinRequestId
      })
    ).rejects.toThrow(ConflictError);
  });
});
