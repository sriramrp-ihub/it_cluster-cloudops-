import { describe, it, expect } from "vitest";
import {
  generateAgentId,
  generateJoinRequestId,
  generateInviteToken,
  generateClaimCredential,
  generateRunId,
  generateApprovalId,
  generateEventId,
  generateCredentialId,
  generateSessionId,
  generateTenantId,
  isAgentId,
  isJoinRequestId,
  isInviteToken,
  isClaimCredential,
  isRunId,
  isApprovalId,
  isEventId
} from "@cloudops/shared";

describe("ID Generators", () => {
  it("generates IDs with correct prefixes", () => {
    expect(generateAgentId().startsWith("ag_")).toBe(true);
    expect(generateJoinRequestId().startsWith("jr_")).toBe(true);
    expect(generateInviteToken().startsWith("co_inv_")).toBe(true);
    expect(generateClaimCredential().startsWith("co_agent_")).toBe(true);
    expect(generateRunId().startsWith("run_")).toBe(true);
    expect(generateApprovalId().startsWith("appr_")).toBe(true);
    expect(generateEventId().startsWith("evt_")).toBe(true);
    expect(generateCredentialId().startsWith("cred_")).toBe(true);
    expect(generateSessionId().startsWith("sess_")).toBe(true);
    expect(generateTenantId().startsWith("ten_")).toBe(true);
  });

  it("enforces minimum 256-bit entropy for Claim Credential", () => {
    const claim = generateClaimCredential();
    const hexPart = claim.replace("co_agent_", "");
    // 32 bytes = 64 hex characters = 256 bits
    expect(hexPart.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hexPart)).toBe(true);
  });

  it("produces unique identifiers without collisions (1,000 IDs per type)", () => {
    const count = 1000;
    const agentIds = new Set(Array.from({ length: count }, () => generateAgentId()));
    const claimCreds = new Set(Array.from({ length: count }, () => generateClaimCredential()));
    const runIds = new Set(Array.from({ length: count }, () => generateRunId()));

    expect(agentIds.size).toBe(count);
    expect(claimCreds.size).toBe(count);
    expect(runIds.size).toBe(count);
  });

  it("validates IDs with type guards accurately", () => {
    const validAgentId = generateAgentId();
    expect(isAgentId(validAgentId)).toBe(true);
    expect(isAgentId("invalid_agent_id")).toBe(false);
    expect(isAgentId("ag_12345")).toBe(false);

    const validJoinReq = generateJoinRequestId();
    expect(isJoinRequestId(validJoinReq)).toBe(true);

    const validInvite = generateInviteToken();
    expect(isInviteToken(validInvite)).toBe(true);
    expect(isInviteToken("co_inv_short")).toBe(false);

    const validClaim = generateClaimCredential();
    expect(isClaimCredential(validClaim)).toBe(true);

    const validRun = generateRunId();
    expect(isRunId(validRun)).toBe(true);

    const validAppr = generateApprovalId();
    expect(isApprovalId(validAppr)).toBe(true);

    const validEvt = generateEventId();
    expect(isEventId(validEvt)).toBe(true);
  });
});
