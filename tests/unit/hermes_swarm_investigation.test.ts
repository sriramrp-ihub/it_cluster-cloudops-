import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile
}));

vi.mock("../../packages/runtime/src/swarmRunTrace.js", () => ({
  createSwarmChildRun: vi.fn().mockResolvedValue(null),
  completeSwarmChildRun: vi.fn().mockResolvedValue(undefined)
}));

import { HermesAgentAdapter, type AgentEvent, type SwarmEligibility } from "@cloudops/runtime";

/**
 * ADR-0007 Phase C1b: HermesAgentAdapter.runInvestigation()'s new tier 0 —
 * a Kanban-Swarm-orchestrated investigation, tried BEFORE Phase B's adaptive
 * tier when the tenant is swarm-eligible. Mocks `node:child_process`'s
 * `execFile` directly (the same technique tests/unit/hermes_governed_profile
 * .test.ts uses for HermesProfileService) since hermesAgentAdapter.ts's new
 * swarm plumbing (runKanbanCli/runHermesOneshotForProfile) imports execFile
 * statically at module scope, unlike the pre-existing
 * executeHermesInference() (which dynamically imports it and is exercised
 * via a real fake-binary shell script in hermes_adaptive_investigation.test.ts
 * instead).
 */

const TENANT_ID = "ten_swarm_test";
const WORKER_PROFILES = ["ag_worker_1", "ag_worker_2", "ag_worker_3"];
const VERIFIER_PROFILE = "ag_verifier_1";
const SYNTHESIZER_PROFILE = "ag_synth_1";

const TOPOLOGY = {
  root_id: "t_root",
  worker_ids: ["t_w1", "t_w2", "t_w3"],
  verifier_id: "t_verifier",
  synthesizer_id: "t_synth"
};

function buildEligibleSwarm(): SwarmEligibility {
  return {
    eligible: true,
    investigators: WORKER_PROFILES.map((p) => ({ agentId: p, hermesProfileName: p })),
    verifier: { agentId: VERIFIER_PROFILE, hermesProfileName: VERIFIER_PROFILE },
    synthesizer: { agentId: SYNTHESIZER_PROFILE, hermesProfileName: SYNTHESIZER_PROFILE },
    reason: null
  };
}

interface Scenario {
  /** task id -> status returned by every `kanban show <id> --json` call for that id. */
  taskStatus: Record<string, string>;
  /** hermes profile name -> raw stdout returned for `-p <profile> -z <prompt> --ignore-rules`. */
  oneshotOutputByProfile: Record<string, string>;
}

function defaultWorkerOutput(tool: string) {
  return JSON.stringify({
    domainFinding: `${tool}: nominal`,
    evidence: `${tool} evidence`,
    narrative: `Checked via ${tool}.`
  });
}

function defaultVerifierOutput() {
  return JSON.stringify({
    verifiedFindings: ["aws_ecs_describe_services: nominal", "aws_cloudwatch_get_metric_data: nominal", "aws_ecs_describe_stopped_tasks: nominal"],
    flaggedInconsistencies: [],
    overallConfidence: 0.93
  });
}

function defaultSynthesizerOutput() {
  return JSON.stringify({
    finding: "Service is healthy",
    rootCause: "No anomalies found across all three swarm worker findings.",
    confidence: 0.93,
    remediationTool: "aws_ecs_describe_services",
    remediationParams: { cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" },
    riskLevel: "LOW",
    requiresApproval: false,
    investigationNarrative: ["Workers checked service/metrics/stopped-tasks.", "Verifier corroborated all findings.", "Synthesized final result."]
  });
}

function defaultScenario(): Scenario {
  return {
    taskStatus: {
      t_w1: "ready",
      t_w2: "ready",
      t_w3: "ready",
      t_verifier: "ready",
      t_synth: "ready"
    },
    oneshotOutputByProfile: {
      ag_worker_1: defaultWorkerOutput("aws_ecs_describe_services"),
      ag_worker_2: defaultWorkerOutput("aws_cloudwatch_get_metric_data"),
      ag_worker_3: defaultWorkerOutput("aws_ecs_describe_stopped_tasks"),
      [VERIFIER_PROFILE]: defaultVerifierOutput(),
      [SYNTHESIZER_PROFILE]: defaultSynthesizerOutput()
    }
  };
}

function wireExecFile(scenario: Scenario) {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
    const fakeChild = { stdin: { write: vi.fn(), end: vi.fn() } };
    queueMicrotask(() => {
      if (args[0] === "kanban" && args[1] === "swarm") {
        cb(null, JSON.stringify(TOPOLOGY), "");
        return;
      }
      if (args[0] === "kanban" && args[1] === "show") {
        const taskId = args[2];
        const status = scenario.taskStatus[taskId] ?? "todo";
        cb(null, JSON.stringify({ task: { id: taskId, status } }), "");
        return;
      }
      if (args[0] === "kanban" && args[1] === "claim") {
        const taskId = args[2];
        if ((scenario.taskStatus[taskId] ?? "todo") !== "ready") {
          cb(null, `cannot claim ${taskId}: status=todo lock=(none)\n`, "");
        } else {
          cb(null, `Claimed ${taskId}\nWorkspace: /tmp/fake-workspace\n`, "");
        }
        return;
      }
      if (args[0] === "kanban" && args[1] === "complete") {
        cb(null, `Completed ${args[2]}\n`, "");
        return;
      }
      if (args[0] === "-p") {
        const profile = args[1];
        const output = scenario.oneshotOutputByProfile[profile];
        if (output === undefined) {
          cb(new Error(`no scenario output configured for profile '${profile}'`), "", "");
        } else {
          cb(null, output, "");
        }
        return;
      }
      // Fixed-script fallback path's own tool calls go through the
      // registered onToolCall handler, not execFile — only its final
      // live-inference synthesis call (`-z <prompt>`, no `-p`) reaches here.
      // Returning empty stdout makes that call unparseable, exercising the
      // fixed path's own grounded-heuristics fallback deterministically.
      cb(null, "", "");
    });
    return fakeChild;
  });
}

async function startSession(adapter: HermesAgentAdapter) {
  return adapter.start({
    tenantId: TENANT_ID,
    agentId: "ag_swarm_trigger",
    incidentContext: {
      incidentId: "inc_swarm_test_001",
      provider: "AWS",
      accountId: "265766933076",
      region: "us-east-1",
      service: "checkout-service",
      resourceId: "arn:aws:ecs:us-east-1:265766933076:service/test/checkout",
      severity: "HIGH",
      title: "Swarm investigation test",
      alertDescription: "Test alert for swarm investigation"
    }
  });
}

describe("HermesAgentAdapter swarm investigation tier (ADR-0007 Phase C1b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: dispatches a real kanban swarm graph, runs 3 workers + verifier + synthesizer, and returns the synthesizer's result as the final InvestigationDriveResult", async () => {
    wireExecFile(defaultScenario());
    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1",
      alertDescription: "Swarm test alert"
    });

    expect(resolveSwarmEligibility).toHaveBeenCalledWith(TENANT_ID);
    expect(result.status).toBe("COMPLETED");
    expect((result.rootCause as any).finding).toBe("Service is healthy");
    expect((result.rootCause as any).dataSource).toBe("live:hermes:swarm");

    // The swarm CLI graph was actually built.
    const swarmCreateCall = mockExecFile.mock.calls.find((c) => c[1][0] === "kanban" && c[1][1] === "swarm");
    expect(swarmCreateCall).toBeDefined();
    expect(swarmCreateCall![1]).toContain("--verifier");
    expect(swarmCreateCall![1]).toContain(VERIFIER_PROFILE);
    expect(swarmCreateCall![1]).toContain("--synthesizer");
    expect(swarmCreateCall![1]).toContain(SYNTHESIZER_PROFILE);

    // All 3 workers were claimed and completed independently.
    const claimCalls = mockExecFile.mock.calls.filter((c) => c[1][0] === "kanban" && c[1][1] === "claim");
    expect(claimCalls.map((c) => c[1][2]).sort()).toEqual(["t_synth", "t_verifier", "t_w1", "t_w2", "t_w3"].sort());
    const completeCalls = mockExecFile.mock.calls.filter((c) => c[1][0] === "kanban" && c[1][1] === "complete");
    expect(completeCalls).toHaveLength(5);

    // Role-labeled toolNames on the reconstructed events — no UI contract change.
    const stepToolNames = events.filter((e) => e.type === "STEP").map((e) => (e.data as any).toolName);
    expect(stepToolNames).toContain("swarm_investigator:aws_ecs_describe_services");
    expect(stepToolNames).toContain("swarm_investigator:aws_cloudwatch_get_metric_data");
    expect(stepToolNames).toContain("swarm_investigator:aws_ecs_describe_stopped_tasks");
    expect(stepToolNames).toContain("swarm_verifier");
    expect(stepToolNames).toContain("swarm_synthesizer");
    expect(events.filter((e) => e.type === "ROOT_CAUSE")).toHaveLength(1);
  });

  it("worker stage timeout falls through to the fixed-script investigation (never hangs)", async () => {
    const scenario = defaultScenario();
    // Worker 2's task never becomes ready — simulates a stuck dependency
    // graph / dispatcher problem.
    scenario.taskStatus.t_w2 = "todo";
    wireExecFile(scenario);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({
      hermesBin: "hermes-fake",
      enableLiveInference: true,
      resolveSwarmEligibility,
      swarmStageTimeoutMs: 50 // bounded and small so this test resolves quickly
    });
    const session = await startSession(adapter);

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    // Falls all the way through to the pre-Phase-B fixed script (no governed
    // profile set on this adapter instance) — proof of a clean failure, not
    // a hang or a crash.
    expect(["COMPLETED", "WAITING_APPROVAL"]).toContain(result.status);
    expect(result.rootCause).toBeDefined();
    expect(typeof (result.rootCause as any).finding).toBe("string");
    const fixedScriptSteps = events.filter((e) => e.type === "STEP" && (e.data as any).toolName === "aws_ecs_describe_services");
    expect(fixedScriptSteps.length).toBeGreaterThanOrEqual(1);
    // The synthesizer stage was never reached — swarm failed before it.
    const synthClaim = mockExecFile.mock.calls.find((c) => c[1][0] === "kanban" && c[1][1] === "claim" && c[1][2] === "t_synth");
    expect(synthClaim).toBeUndefined();
  }, 10000);

  it("unparseable synthesizer output falls through to the fixed-script investigation, after the workers and verifier genuinely ran", async () => {
    const scenario = defaultScenario();
    scenario.oneshotOutputByProfile[SYNTHESIZER_PROFILE] = "This is not JSON at all.";
    wireExecFile(scenario);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    expect(["COMPLETED", "WAITING_APPROVAL"]).toContain(result.status);
    expect(result.rootCause).toBeDefined();
    expect(typeof (result.rootCause as any).finding).toBe("string");
    expect((result.rootCause as any).finding.length).toBeGreaterThan(0);

    // Proof the swarm actually progressed through workers + verifier before
    // failing at the synthesizer stage specifically.
    const completeCalls = mockExecFile.mock.calls.filter((c) => c[1][0] === "kanban" && c[1][1] === "complete");
    const completedTaskIds = completeCalls.map((c) => c[1][2]);
    expect(completedTaskIds).toEqual(expect.arrayContaining(["t_w1", "t_w2", "t_w3", "t_verifier"]));
    expect(completedTaskIds).not.toContain("t_synth");

    // Fell all the way through to the fixed script (no governed profile set).
    const fixedScriptSteps = events.filter((e) => e.type === "STEP" && (e.data as any).toolName === "aws_ecs_describe_services");
    expect(fixedScriptSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("does not attempt the swarm tier at all when the tenant is not swarm-eligible (default/unchanged behavior)", async () => {
    wireExecFile(defaultScenario());
    const resolveSwarmEligibility = vi.fn().mockResolvedValue({
      eligible: false,
      investigators: [],
      verifier: null,
      synthesizer: null,
      reason: "No role-tagged agents onboarded for this tenant."
    } satisfies SwarmEligibility);
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    expect(resolveSwarmEligibility).toHaveBeenCalledWith(TENANT_ID);
    // No kanban CLI call of any kind was made.
    const kanbanCalls = mockExecFile.mock.calls.filter((c) => c[1][0] === "kanban");
    expect(kanbanCalls).toHaveLength(0);
  });
});
