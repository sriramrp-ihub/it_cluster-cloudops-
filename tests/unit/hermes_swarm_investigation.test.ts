import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecFile, mockCreateSwarmChildRun, mockCompleteSwarmChildRun, mockListToolExecutionsForRun } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockCreateSwarmChildRun: vi.fn().mockResolvedValue(null),
  mockCompleteSwarmChildRun: vi.fn().mockResolvedValue(undefined),
  // ADR-0007 Phase C1b live-progress feature: defaults to "no rows, ever" —
  // every pre-existing test in this file leaves `createSwarmChildRun`
  // returning `null` (its own default above), which alone already makes
  // `startProgressPolling()` a no-op (see swarmProgressPoller.ts) that never
  // calls this at all. Only the dedicated "live progress polling" describe
  // block below reconfigures both mocks together to exercise real polling.
  mockListToolExecutionsForRun: vi.fn().mockResolvedValue([])
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile
}));

vi.mock("../../packages/runtime/src/swarmRunTrace.js", () => ({
  createSwarmChildRun: mockCreateSwarmChildRun,
  completeSwarmChildRun: mockCompleteSwarmChildRun,
  listToolExecutionsForRun: mockListToolExecutionsForRun
}));

import { HermesAgentAdapter, type AgentEvent, type SwarmEligibility } from "@cloudops/runtime";

/**
 * ADR-0007 Phase C1b: HermesAgentAdapter.runInvestigation()'s tier 0 — a
 * Kanban-Swarm-orchestrated investigation, tried BEFORE Phase B's adaptive
 * tier when the tenant is swarm-eligible. Mocks `node:child_process`'s
 * `execFile` directly (the same technique tests/unit/hermes_governed_profile
 * .test.ts uses for HermesProfileService) since hermesAgentAdapter.ts's
 * swarm plumbing (runKanbanCli/runHermesOneshotForProfile) imports execFile
 * statically at module scope, unlike the pre-existing
 * executeHermesInference() (which dynamically imports it and is exercised
 * via a real fake-binary shell script in hermes_adaptive_investigation.test.ts
 * instead).
 *
 * Post-dynamic-worker-rewrite: there is NO fixed tool-per-worker mapping in
 * the production code any more (see runSwarmInvestigation() in
 * hermesAgentAdapter.ts) — each worker is handed the incident + an
 * investigative ANGLE (a framing lens, e.g. "Service health investigation"),
 * never a pre-assigned tool, and is free to call zero, one, or several real
 * tools via its own governed Hermes profile's MCP tool-calling loop before
 * concluding. These tests deliberately configure the 3 mocked workers to
 * report DIFFERENT tool-usage shapes (zero tools / one tool / two tools,
 * including a tool that didn't even exist in the old fixed 3-tool plan) to
 * prove the pipeline has no hidden expectation about which tool(s), or how
 * many, a worker uses — and assert directly against the actual prompt text
 * sent to each worker profile to prove no tool name is ever pre-assigned.
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

function workerOutput(finding: string, toolsUsed: string[], evidence: unknown = null) {
  return JSON.stringify({
    domainFinding: finding,
    evidence,
    toolsUsed,
    narrative: `Investigated and found: ${finding}`
  });
}

function defaultVerifierOutput() {
  return JSON.stringify({
    verifiedFindings: ["worker 1 finding corroborated", "worker 2 finding corroborated", "worker 3 finding corroborated"],
    flaggedInconsistencies: [],
    overallConfidence: 0.93
  });
}

function defaultSynthesizerOutput() {
  return JSON.stringify({
    finding: "Service is healthy",
    rootCause: "No anomalies found across the workers' independently-chosen investigation angles.",
    confidence: 0.93,
    remediationTool: "aws_ecs_describe_services",
    remediationParams: { cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" },
    riskLevel: "LOW",
    requiresApproval: false,
    investigationNarrative: ["Workers investigated independently, each choosing their own tools.", "Verifier corroborated all findings.", "Synthesized final result."]
  });
}

/**
 * Deliberately varied tool-usage shapes across the 3 mocked workers — one
 * calls zero tools, one calls a single (new, post-registry-expansion) tool,
 * one calls two tools including one never present in the old fixed plan.
 * Nothing in this shape is special-cased by the production code; if it
 * were, at least one of these workers would fail to produce a usable result.
 */
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
      ag_worker_1: workerOutput("Service is at desired task count with a healthy rollout.", [], null),
      ag_worker_2: workerOutput(
        "ALB target group reports all targets healthy; no correlated 5xx spike.",
        ["aws_alb_get_target_health"],
        { healthyTargets: 2, unhealthyTargets: 0 }
      ),
      ag_worker_3: workerOutput(
        "No stopped tasks in the last hour; current image digest matches the last known-good ECR push.",
        ["aws_ecs_describe_tasks", "aws_ecr_describe_images"],
        { stoppedTaskCount: 0 }
      ),
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

/** Every `-p <profile> -z <prompt> --ignore-rules` oneshot call made to a worker profile. */
function workerOneshotCalls() {
  return mockExecFile.mock.calls.filter((c) => c[1][0] === "-p" && WORKER_PROFILES.includes(c[1][1]));
}

describe("HermesAgentAdapter swarm investigation tier (ADR-0007 Phase C1b) — dynamic workers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: dispatches a real kanban swarm graph, runs 3 workers + verifier + synthesizer with NO fixed tool-per-worker mapping, and returns the synthesizer's result", async () => {
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
    // Bug fix: a healthy finding whose "remediation" is really just the
    // read-only aws_ecs_describe_services confirmation call must not be
    // presented as an action needing authorization.
    expect((result.rootCause as any).recommendedRemediation.actionNeeded).toBe(false);
    expect((result.rootCause as any).recommendedRemediation.requiresApproval).toBe(false);

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

    // ── No hardcoded tool-per-worker mapping: each worker's prompt is an
    // investigative ANGLE, not a "call tool X" instruction, and no two
    // workers were given the same angle. ────────────────────────────────
    const oneshotCalls = workerOneshotCalls();
    expect(oneshotCalls).toHaveLength(3);
    const lensTitles = oneshotCalls.map((c) => {
      const prompt = c[1][3] as string;
      return prompt.match(/investigative lens is: "([^"]+)"/)?.[1];
    });
    expect(lensTitles.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
    expect(new Set(lensTitles).size).toBe(3); // three distinct angles, not one repeated
    for (const call of oneshotCalls) {
      const prompt = call[1][3] as string;
      // The old scripted plan told the worker exactly which tool to call
      // ("Call the "aws_ecs_describe_services" tool for ..."). That
      // instruction shape must never reappear.
      expect(prompt).not.toMatch(/Call the "aws_[a-z_]+" tool/);
      expect(prompt).toContain("whatever diagnostic tools are available to you");
      expect(prompt).toContain("zero, one, or several tools");
    }

    // Role-labeled toolNames on the reconstructed events, now keyed by the
    // worker's ANGLE (slugified), never a literal AWS tool name — no UI
    // contract change (still "swarm_investigator:<label>"), just what the
    // label means (see hermesAgentAdapter.ts's runSwarmInvestigation()).
    const stepToolNames = events.filter((e) => e.type === "STEP").map((e) => (e.data as any).toolName);
    expect(stepToolNames).toContain("swarm_investigator:service_health_investigation");
    expect(stepToolNames).toContain("swarm_investigator:traffic_and_error_rate_investigation");
    expect(stepToolNames).toContain("swarm_investigator:recent_failure_investigation");
    expect(stepToolNames).toContain("swarm_verifier");
    expect(stepToolNames).toContain("swarm_synthesizer");
    expect(events.filter((e) => e.type === "ROOT_CAUSE")).toHaveLength(1);

    // The dynamic tool-usage shapes each worker reported (0 tools / 1 tool /
    // 2 tools, including a tool absent from the old fixed plan) all flowed
    // through to a completed, successful result — proof the pipeline has no
    // hidden expectation about which or how many tools a worker calls.
    const observations = events.filter((e) => e.type === "OBSERVATION").map((e) => (e.data as any).observation as string);
    expect(observations.some((o) => o.includes("reached finding without calling a tool"))).toBe(true);
    expect(observations.some((o) => o.includes("[tool(s) used: aws_alb_get_target_health]"))).toBe(true);
    expect(observations.some((o) => o.includes("[tool(s) used: aws_ecs_describe_tasks, aws_ecr_describe_images]"))).toBe(true);
  });

  it("clean verifier gate (no flagged inconsistencies) produces verificationStatus: 'verified' with an empty flaggedInconsistencies array and a 'Validated' confidenceLabel", async () => {
    // defaultScenario()'s verifier output already has flaggedInconsistencies: []
    // and overallConfidence: 0.93 (>= the 0.85 HIGH_CONFIDENCE bar) — the real
    // "clean verification" case, same shape observed live for run_d9ebcace...
    // in ten_swarm_demo_1790683579's history.
    wireExecFile(defaultScenario());
    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    const rootCause = result.rootCause as any;
    expect(rootCause.verificationStatus).toBe("verified");
    expect(rootCause.flaggedInconsistencies).toEqual([]);
    expect(rootCause.confidenceLabel).toBe("Validated — no contradictions found");
  });

  it("verifier flags a real inconsistency → verificationStatus: 'flagged' with the ACTUAL inconsistency text carried through unchanged, and a 'Supported by evidence' confidenceLabel", async () => {
    // Real inconsistency text observed live in ten_swarm_demo_1790683579's
    // history (verifier sub-run run_98824d63-d11d-4f7c-844c-26207291a182,
    // parent run_371b6c5d-e558-4a22-a418-c7ff2df4eddc): two workers reported
    // different ECS task counts for the same service.
    const REAL_FLAGGED_INCONSISTENCY =
      "Contradiction in task counts: Worker 1 reports 2 desired/2 running tasks, while Worker 3 reports 1 desired/1 running task.";
    const scenario = defaultScenario();
    scenario.oneshotOutputByProfile[VERIFIER_PROFILE] = JSON.stringify({
      verifiedFindings: ["worker 2 finding corroborated"],
      flaggedInconsistencies: [REAL_FLAGGED_INCONSISTENCY],
      overallConfidence: 0.8
    });
    wireExecFile(scenario);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    const rootCause = result.rootCause as any;
    expect(rootCause.verificationStatus).toBe("flagged");
    // Carried through verbatim from the verifier's own output — never
    // reworded, summarized, or re-derived by the synthesizer/UI.
    expect(rootCause.flaggedInconsistencies).toEqual([REAL_FLAGGED_INCONSISTENCY]);
    expect(rootCause.confidenceLabel).toBe("Supported by evidence — one inconsistency noted");
  });

  it("verifier flags multiple (>=2) independent inconsistencies → 'Inconclusive' confidenceLabel even though the gate is only 'flagged', not a bare 'Supported by evidence'", async () => {
    const scenario = defaultScenario();
    scenario.oneshotOutputByProfile[VERIFIER_PROFILE] = JSON.stringify({
      verifiedFindings: [],
      flaggedInconsistencies: [
        "Worker 1 reports 2/2 tasks, Worker 3 reports 1/1 tasks.",
        "Worker 2 reports zero 5xx errors, Worker 3 reports a 100% 5xx error rate."
      ],
      overallConfidence: 0.7
    });
    wireExecFile(scenario);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    const rootCause = result.rootCause as any;
    expect(rootCause.verificationStatus).toBe("flagged");
    expect(rootCause.flaggedInconsistencies).toHaveLength(2);
    expect(rootCause.confidenceLabel).toBe("Inconclusive — 2 independent inconsistencies flagged");
  });

  it("a worker calling an unexpected/different real tool than any other worker still produces a correct overall result", async () => {
    const scenario = defaultScenario();
    // Reassign worker 1 (angle 0, normally zero tools) to call a completely
    // different, newly-added tool than either of the other two workers —
    // proving no worker index/angle is secretly bound to a specific tool.
    scenario.oneshotOutputByProfile.ag_worker_1 = workerOutput(
      "ECR image digest for the running task matches the latest pushed tag; no drift detected.",
      ["aws_ecr_describe_images"],
      { imageDigest: "sha256:abc123" }
    );
    wireExecFile(scenario);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({ hermesBin: "hermes-fake", enableLiveInference: true, resolveSwarmEligibility });
    const session = await startSession(adapter);

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    expect(result.status).toBe("COMPLETED");
    expect((result.rootCause as any).finding).toBe("Service is healthy");
    const completeCalls = mockExecFile.mock.calls.filter((c) => c[1][0] === "kanban" && c[1][1] === "complete");
    expect(completeCalls).toHaveLength(5);
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
    // Fell all the way through to the fixed-script tier, which has no
    // independent verification stage — must honestly report "unverified",
    // never a fabricated "verified" just because the swarm partially ran.
    expect((result.rootCause as any).verificationStatus).toBe("unverified");
    expect((result.rootCause as any).flaggedInconsistencies).toEqual([]);
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

/**
 * ADR-0007 Phase C1b live-progress feature (packages/runtime/src/
 * swarmProgressPoller.ts, wired into runSwarmInvestigation() via
 * HermesAgentAdapter.startProgressPolling()): while a worker/verifier/
 * synthesizer's own `runHermesOneshotForProfile()` call is still in flight,
 * newly-persisted `tool_executions` rows for that stage's own child run id
 * are surfaced live as "PROGRESS" AgentEvents, instead of the operator
 * seeing a static "Running" card for up to `swarmStageTimeoutMs`.
 *
 * Every test above this leaves `createSwarmChildRun` returning `null` (its
 * hoisted default), which alone makes `startProgressPolling()` a no-op that
 * never calls `listToolExecutionsForRun` at all — proof this feature is
 * fully opt-in and inert wherever child-run-id tracing isn't available. This
 * block is the one place both mocks are reconfigured together to prove the
 * real wiring: PROGRESS events genuinely arrive mid-flight (not just at
 * completion), and polling stops cleanly (no dangling interval / no
 * spurious late events) once the observed oneshot call settles, whether by
 * success or failure.
 *
 * Uses REAL timers with an injected small `swarmProgressPollIntervalMs`
 * (this repo has no prior fake-timer convention — checked before writing
 * this) rather than `vi.useFakeTimers()`, since the surrounding swarm
 * pipeline this exercises already coordinates several real async stages
 * (kanban claim/poll, Promise.all across 3 workers) via `queueMicrotask` in
 * `wireExecFile`'s mock — the isolated polling/dedup LOGIC itself (seed vs.
 * new, stop-clears-interval, fail-soft) is unit-tested with fake timers
 * instead, in tests/unit/swarm_progress_poller.test.ts.
 */
describe("HermesAgentAdapter swarm investigation tier — live progress polling wiring (ADR-0007 Phase C1b)", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  type FakeToolExecutionRow = { id: string; toolName: string; status: string; createdAt: Date };

  /**
   * Like `wireExecFile` above, except the oneshot call for `heldProfile`
   * (`-p <heldProfile> -z ...`) is deliberately never auto-resolved — its
   * callback is captured instead, so the test can keep it "in flight" for as
   * long as needed before manually resolving or rejecting it, simulating a
   * worker genuinely still exploring tools (or a timeout kill) mid-oneshot.
   */
  function wireExecFileWithHeldProfile(scenario: Scenario, heldProfile: string) {
    let capturedCb: ((err: any, stdout: string, stderr: string) => void) | null = null;
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: any) => {
      const fakeChild = { stdin: { write: vi.fn(), end: vi.fn() } };
      if (args[0] === "-p" && args[1] === heldProfile) {
        capturedCb = cb;
        return fakeChild;
      }
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
        cb(null, "", "");
      });
      return fakeChild;
    });
    return {
      resolveHeld: (output: string) => {
        if (!capturedCb) throw new Error(`${heldProfile}'s oneshot execFile call was never made`);
        capturedCb(null, output, "");
      },
      rejectHeld: (message: string) => {
        if (!capturedCb) throw new Error(`${heldProfile}'s oneshot execFile call was never made`);
        capturedCb(new Error(message), "", "");
      }
    };
  }

  afterEach(() => {
    // These two mocks are reconfigured together by every test in this block
    // — restore both to this file's shared defaults (null childRunId / no
    // rows) so no override leaks into any test defined above.
    mockCreateSwarmChildRun.mockReset();
    mockCreateSwarmChildRun.mockResolvedValue(null);
    mockCompleteSwarmChildRun.mockReset();
    mockCompleteSwarmChildRun.mockResolvedValue(undefined);
    mockListToolExecutionsForRun.mockReset();
    mockListToolExecutionsForRun.mockResolvedValue([]);
  });

  it("emits PROGRESS events for tool calls observed while a worker's oneshot is still in flight, and stops once it resolves", async () => {
    const scenario = defaultScenario();
    const { resolveHeld } = wireExecFileWithHeldProfile(scenario, "ag_worker_1");

    mockCreateSwarmChildRun.mockImplementation(async (params: any) => `run_child_${params.agentId}`);
    const rowsByRun: Record<string, FakeToolExecutionRow[]> = {};
    mockListToolExecutionsForRun.mockImplementation(async (runId: string) => rowsByRun[runId] || []);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({
      hermesBin: "hermes-fake",
      enableLiveInference: true,
      resolveSwarmEligibility,
      swarmProgressPollIntervalMs: 15
    });
    const session = await startSession(adapter);
    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const resultPromise = adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    // Let the swarm graph stand up, worker 1 claim its task, and the
    // progress poller's own seed tick fire — no tool has "run" yet.
    await sleep(40);
    expect(events.filter((e) => e.type === "PROGRESS")).toHaveLength(0);

    // Worker 1's oneshot call is STILL unresolved at this point (its
    // execFile callback is being deliberately held) — simulate
    // CloudOpsMcpServer persisting its first real tool call mid-flight.
    rowsByRun["run_child_ag_worker_1"] = [
      { id: "te_1", toolName: "aws_ecs_describe_services", status: "SUCCESS", createdAt: new Date() }
    ];
    await sleep(40);
    let progressEvents = events.filter((e) => e.type === "PROGRESS");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(progressEvents[0]!.data.toolName).toBe("swarm_investigator:service_health_investigation");
    expect(progressEvents[0]!.data.calledTool).toBe("aws_ecs_describe_services");

    // A second tool call appears — the oneshot STILL hasn't resolved.
    rowsByRun["run_child_ag_worker_1"] = [
      ...rowsByRun["run_child_ag_worker_1"]!,
      { id: "te_2", toolName: "aws_cloudwatch_get_metric_data", status: "SUCCESS", createdAt: new Date() }
    ];
    await sleep(40);
    progressEvents = events.filter((e) => e.type === "PROGRESS");
    expect(progressEvents.some((e) => e.data.calledTool === "aws_cloudwatch_get_metric_data")).toBe(true);
    const progressCountBeforeResolve = progressEvents.length;

    // Worker 1 finally finishes.
    resolveHeld(workerOutput("Service is at desired task count.", ["aws_ecs_describe_services", "aws_cloudwatch_get_metric_data"]));
    const result = await resultPromise;
    expect(result.status).toBe("COMPLETED");

    // A THIRD row appears only AFTER the worker's own oneshot already
    // resolved — this must never surface as a PROGRESS event, proving
    // polling actually stopped rather than merely slowing down.
    rowsByRun["run_child_ag_worker_1"] = [
      ...rowsByRun["run_child_ag_worker_1"]!,
      { id: "te_3", toolName: "aws_ecr_describe_images", status: "SUCCESS", createdAt: new Date() }
    ];
    await sleep(60);
    const finalProgressEvents = events.filter((e) => e.type === "PROGRESS");
    expect(finalProgressEvents.length).toBe(progressCountBeforeResolve);
    expect(finalProgressEvents.some((e) => e.data.calledTool === "aws_ecr_describe_images")).toBe(false);
  });

  it("stops polling with no dangling interval when the oneshot call itself fails (e.g. a timeout kill)", async () => {
    const scenario = defaultScenario();
    const { rejectHeld } = wireExecFileWithHeldProfile(scenario, "ag_worker_1");

    mockCreateSwarmChildRun.mockImplementation(async (params: any) => `run_child_${params.agentId}`);
    const rowsByRun: Record<string, FakeToolExecutionRow[]> = { run_child_ag_worker_1: [] };
    mockListToolExecutionsForRun.mockImplementation(async (runId: string) => rowsByRun[runId] || []);

    const resolveSwarmEligibility = vi.fn().mockResolvedValue(buildEligibleSwarm());
    const adapter = new HermesAgentAdapter({
      hermesBin: "hermes-fake",
      enableLiveInference: true,
      resolveSwarmEligibility,
      swarmProgressPollIntervalMs: 15
    });
    const session = await startSession(adapter);
    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const resultPromise = adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    await sleep(40);
    rowsByRun["run_child_ag_worker_1"] = [
      { id: "te_1", toolName: "aws_ecs_describe_services", status: "SUCCESS", createdAt: new Date() }
    ];
    await sleep(40);
    expect(events.filter((e) => e.type === "PROGRESS").length).toBeGreaterThanOrEqual(1);

    // Simulate execFile's own timeout kill: Command failed, empty stderr —
    // the exact signature this session's real logs showed for a genuinely
    // long-running multi-tool worker hitting the old 90s ceiling.
    rejectHeld("Command failed: hermes -p ag_worker_1 -z ... (timeout)");

    // Worker 1 rejects -> Promise.all rejects -> the swarm falls through to
    // the fixed-script tier (no governed profile set on this adapter).
    const result = await resultPromise;
    expect(["COMPLETED", "WAITING_APPROVAL"]).toContain(result.status);

    const callCountRightAfterFailure = mockListToolExecutionsForRun.mock.calls.length;
    // A further row appears well after the failure — if the interval were
    // still alive, it would have polled again and this test would fail.
    rowsByRun["run_child_ag_worker_1"] = [
      ...rowsByRun["run_child_ag_worker_1"]!,
      { id: "te_2", toolName: "aws_cloudwatch_get_metric_data", status: "SUCCESS", createdAt: new Date() }
    ];
    await sleep(80);
    expect(mockListToolExecutionsForRun.mock.calls.length).toBe(callCountRightAfterFailure);
  });
});
