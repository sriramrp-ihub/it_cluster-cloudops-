import { describe, it, expect, vi } from "vitest";
import { resolveSwarmParticipants } from "@cloudops/runtime";

/**
 * ADR-0007 Phase C1b: resolveSwarmParticipants() eligibility rules —
 * >= 1 'investigator' + exactly one 'verifier' + one 'synthesizer', each
 * independently RE-VERIFIED FRESH via HermesProfileService.verifyGovernance()
 * at trigger time rather than trusting each row's stored governance_status
 * alone (the "don't trust provisioning-time success alone" principle
 * ADR-0008 Phase A/B already established, applied here to the
 * swarm-eligibility decision itself).
 */

interface AgentRow {
  id: string;
  role: string;
  hermes_profile_name: string | null;
  governance_status: string;
}

function createDbMock(rows: AgentRow[]) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(rows)
  };
  return { selectFrom: vi.fn().mockReturnValue(chain), _chain: chain } as any;
}

function createHermesProfileServiceMock(
  verdictByAgentId: Record<string, "LOCKED_DOWN" | "FAILED">
) {
  const verifyGovernance = vi.fn(async (_tenantId: string, agentId: string) => {
    const status = verdictByAgentId[agentId] ?? "FAILED";
    return {
      agentId,
      hermesProfileName: `${agentId}`,
      governanceStatus: status,
      toolsetsLockedDown: status === "LOCKED_DOWN",
      enabledNativeToolsets: [],
      mcpRegistered: status === "LOCKED_DOWN",
      mcpServers: status === "LOCKED_DOWN" ? ["cloudops-control-plane"] : [],
      verifiedAt: new Date(),
      errors: status === "LOCKED_DOWN" ? [] : ["simulated drift"]
    };
  });
  return { verifyGovernance } as any;
}

describe("resolveSwarmParticipants (ADR-0007 Phase C1b)", () => {
  it("returns ineligible with ZERO DB filtering beyond the role query and ZERO verifyGovernance calls when no role-tagged agents exist — proves every tenant that hasn't deliberately onboarded a role-tagged fleet (i.e. everyone today) is provably unchanged", async () => {
    const db = createDbMock([]);
    const hermesProfileService = createHermesProfileServiceMock({});

    const result = await resolveSwarmParticipants("ten_default", { db, hermesProfileService });

    expect(result.eligible).toBe(false);
    expect(result.investigators).toEqual([]);
    expect(result.verifier).toBeNull();
    expect(result.synthesizer).toBeNull();
    expect(hermesProfileService.verifyGovernance).not.toHaveBeenCalled();
  });

  it("returns ineligible and skips live re-verification entirely when role-tagged agents exist but none are on record as LOCKED_DOWN", async () => {
    const db = createDbMock([
      { id: "ag_investigator_1", role: "investigator", hermes_profile_name: "ag_investigator_1", governance_status: "PENDING" },
      { id: "ag_verifier_1", role: "verifier", hermes_profile_name: null, governance_status: "PENDING" }
    ]);
    const hermesProfileService = createHermesProfileServiceMock({});

    const result = await resolveSwarmParticipants("ten_test", { db, hermesProfileService });

    expect(result.eligible).toBe(false);
    expect(hermesProfileService.verifyGovernance).not.toHaveBeenCalled();
  });

  it("is eligible with >=1 investigator + exactly one verifier + one synthesizer, all freshly re-verified LOCKED_DOWN", async () => {
    const db = createDbMock([
      { id: "ag_investigator_1", role: "investigator", hermes_profile_name: "ag_investigator_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_investigator_2", role: "investigator", hermes_profile_name: "ag_investigator_2", governance_status: "LOCKED_DOWN" },
      { id: "ag_investigator_3", role: "investigator", hermes_profile_name: "ag_investigator_3", governance_status: "LOCKED_DOWN" },
      { id: "ag_verifier_1", role: "verifier", hermes_profile_name: "ag_verifier_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_synthesizer_1", role: "synthesizer", hermes_profile_name: "ag_synthesizer_1", governance_status: "LOCKED_DOWN" }
    ]);
    const hermesProfileService = createHermesProfileServiceMock({
      ag_investigator_1: "LOCKED_DOWN",
      ag_investigator_2: "LOCKED_DOWN",
      ag_investigator_3: "LOCKED_DOWN",
      ag_verifier_1: "LOCKED_DOWN",
      ag_synthesizer_1: "LOCKED_DOWN"
    });

    const result = await resolveSwarmParticipants("ten_test", { db, hermesProfileService });

    expect(result.eligible).toBe(true);
    expect(result.investigators).toHaveLength(3);
    expect(result.verifier).toEqual({ agentId: "ag_verifier_1", hermesProfileName: "ag_verifier_1" });
    expect(result.synthesizer).toEqual({ agentId: "ag_synthesizer_1", hermesProfileName: "ag_synthesizer_1" });
    // Fresh re-verification was actually invoked for every candidate — not
    // just the stored flag trusted.
    expect(hermesProfileService.verifyGovernance).toHaveBeenCalledTimes(5);
  });

  it("stale-flag-fails-fresh-reverify: a verifier stored as LOCKED_DOWN that FAILS fresh re-verification is excluded, making the tenant ineligible", async () => {
    const db = createDbMock([
      { id: "ag_investigator_1", role: "investigator", hermes_profile_name: "ag_investigator_1", governance_status: "LOCKED_DOWN" },
      // Stored flag says LOCKED_DOWN (stale/drifted) — the live CLI
      // re-verification below says otherwise.
      { id: "ag_verifier_1", role: "verifier", hermes_profile_name: "ag_verifier_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_synthesizer_1", role: "synthesizer", hermes_profile_name: "ag_synthesizer_1", governance_status: "LOCKED_DOWN" }
    ]);
    const hermesProfileService = createHermesProfileServiceMock({
      ag_investigator_1: "LOCKED_DOWN",
      ag_verifier_1: "FAILED", // drifted since provisioning — a re-enabled toolset, e.g.
      ag_synthesizer_1: "LOCKED_DOWN"
    });

    const result = await resolveSwarmParticipants("ten_test", { db, hermesProfileService });

    expect(hermesProfileService.verifyGovernance).toHaveBeenCalledWith("ten_test", "ag_verifier_1");
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/verifier/i);
  });

  it("is ineligible (fails closed) when more than one verifier candidate passes fresh re-verification — ambiguous role assignment", async () => {
    const db = createDbMock([
      { id: "ag_investigator_1", role: "investigator", hermes_profile_name: "ag_investigator_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_verifier_1", role: "verifier", hermes_profile_name: "ag_verifier_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_verifier_2", role: "verifier", hermes_profile_name: "ag_verifier_2", governance_status: "LOCKED_DOWN" },
      { id: "ag_synthesizer_1", role: "synthesizer", hermes_profile_name: "ag_synthesizer_1", governance_status: "LOCKED_DOWN" }
    ]);
    const hermesProfileService = createHermesProfileServiceMock({
      ag_investigator_1: "LOCKED_DOWN",
      ag_verifier_1: "LOCKED_DOWN",
      ag_verifier_2: "LOCKED_DOWN",
      ag_synthesizer_1: "LOCKED_DOWN"
    });

    const result = await resolveSwarmParticipants("ten_test", { db, hermesProfileService });

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/exactly one.*verifier/i);
  });

  it("is ineligible when zero investigator candidates survive fresh re-verification", async () => {
    const db = createDbMock([
      { id: "ag_investigator_1", role: "investigator", hermes_profile_name: "ag_investigator_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_verifier_1", role: "verifier", hermes_profile_name: "ag_verifier_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_synthesizer_1", role: "synthesizer", hermes_profile_name: "ag_synthesizer_1", governance_status: "LOCKED_DOWN" }
    ]);
    const hermesProfileService = createHermesProfileServiceMock({
      ag_investigator_1: "FAILED",
      ag_verifier_1: "LOCKED_DOWN",
      ag_synthesizer_1: "LOCKED_DOWN"
    });

    const result = await resolveSwarmParticipants("ten_test", { db, hermesProfileService });

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/investigator/i);
  });

  it("excludes (does not throw for) a candidate whose fresh verifyGovernance call itself throws — fails closed", async () => {
    const db = createDbMock([
      { id: "ag_investigator_1", role: "investigator", hermes_profile_name: "ag_investigator_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_verifier_1", role: "verifier", hermes_profile_name: "ag_verifier_1", governance_status: "LOCKED_DOWN" },
      { id: "ag_synthesizer_1", role: "synthesizer", hermes_profile_name: "ag_synthesizer_1", governance_status: "LOCKED_DOWN" }
    ]);
    const hermesProfileService = {
      verifyGovernance: vi.fn(async (_tenantId: string, agentId: string) => {
        if (agentId === "ag_verifier_1") {
          throw new Error("hermes CLI unreachable");
        }
        return {
          agentId,
          hermesProfileName: agentId,
          governanceStatus: "LOCKED_DOWN",
          toolsetsLockedDown: true,
          enabledNativeToolsets: [],
          mcpRegistered: true,
          mcpServers: ["cloudops-control-plane"],
          verifiedAt: new Date(),
          errors: []
        };
      })
    } as any;

    const result = await resolveSwarmParticipants("ten_test", { db, hermesProfileService });

    expect(result.eligible).toBe(false);
  });
});
