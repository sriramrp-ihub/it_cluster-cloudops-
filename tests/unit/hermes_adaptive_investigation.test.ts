import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HermesAgentAdapter,
  type AgentEvent,
  type AgentToolCall,
  type AgentToolResult
} from "@cloudops/runtime";

/**
 * ADR-0008 Phase B (§4.1/§4.2): HermesAgentAdapter.runInvestigation() tries
 * an adaptive, Hermes-driven investigation loop when the agent has its own
 * governed profile (hermesProfileName set), and falls back to the pre-Phase-B
 * fixed 3-step script on ANY failure.
 *
 * Matches the existing test convention for this exact class
 * (tests/unit/llm_output_redaction.test.ts): a real, tiny shell script stands
 * in for the `hermes` binary rather than mocking node:child_process, since
 * executeHermesInference dynamically imports it. Each fake script also
 * appends its invocation args to a log file, so tests can assert the real
 * CLI invocation shape (-p <profile> -z <prompt> --ignore-rules) without
 * needing to intercept execFile directly.
 */

const scratchFiles: string[] = [];

/**
 * The prompt argument is itself a multi-line string (see
 * runAdaptiveInvestigation's/runFixedScriptInvestigation's templates), so a
 * naive `echo "$@" >> log` followed by splitting the log file on "\n" would
 * miscount one real invocation as many "lines". Each invocation instead
 * appends its full args as one `printf '%s'` write, terminated by a NUL byte
 * (`\000`) — a separator that can't appear in ordinary prompt text — so
 * `readInvocations()` below can reliably recover exactly one entry per real
 * execFile call regardless of how many newlines the prompt itself contains.
 */
function writeFakeHermesScript(opts: { stdout: string; argsLogPath?: string }): string {
  const scriptPath = path.join(os.tmpdir(), `fake_hermes_adaptive_${Date.now()}_${Math.random().toString(36).slice(2)}.sh`);
  const logLine = opts.argsLogPath
    ? `printf '%s' "$*" >> "${opts.argsLogPath}"\nprintf '\\000' >> "${opts.argsLogPath}"\n`
    : "";
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh\n${logLine}cat <<'PAYLOAD_EOF'\n${opts.stdout}\nPAYLOAD_EOF\n`,
    { mode: 0o755 }
  );
  scratchFiles.push(scriptPath);
  return scriptPath;
}

function readInvocations(argsLogPath: string): string[] {
  return fs
    .readFileSync(argsLogPath, "utf8")
    .split("\0")
    .filter((entry) => entry.length > 0);
}

function makeArgsLogPath(): string {
  const p = path.join(os.tmpdir(), `fake_hermes_args_${Date.now()}_${Math.random().toString(36).slice(2)}.log`);
  scratchFiles.push(p);
  return p;
}

afterEach(() => {
  while (scratchFiles.length > 0) {
    const f = scratchFiles.pop()!;
    try {
      fs.unlinkSync(f);
    } catch {
      // already removed or never created — fine
    }
  }
});

async function startSession(adapter: HermesAgentAdapter) {
  return adapter.start({
    tenantId: "ten_adaptive_test",
    agentId: "ag_adaptive_test",
    incidentContext: {
      incidentId: "inc_adaptive_test_001",
      provider: "AWS",
      accountId: "265766933076",
      region: "us-east-1",
      service: "checkout-service",
      resourceId: "arn:aws:ecs:us-east-1:265766933076:service/test/checkout",
      severity: "HIGH",
      title: "Adaptive investigation test",
      alertDescription: "Test alert for adaptive investigation"
    }
  });
}

describe("HermesAgentAdapter adaptive investigation loop (ADR-0008 Phase B)", () => {
  it("uses the adaptive path (-p <profile> -z ... --ignore-rules) when hermesProfileName is set", async () => {
    const argsLog = makeArgsLogPath();
    const scriptPath = writeFakeHermesScript({
      argsLogPath: argsLog,
      stdout: JSON.stringify({
        finding: "Service is healthy",
        rootCause: "No failure detected during adaptive investigation.",
        confidence: 0.9,
        remediationTool: "aws_ecs_describe_services",
        remediationParams: { cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" },
        riskLevel: "LOW",
        requiresApproval: false,
        investigationNarrative: ["Checked service health.", "Checked recent stopped tasks."]
      })
    });

    const adapter = new HermesAgentAdapter({ hermesBin: scriptPath, enableLiveInference: true });
    adapter.hermesProfileName = "ag_adaptive_test";
    const session = await startSession(adapter);

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1",
      alertDescription: "Adaptive test alert"
    });

    expect(result.status).toBe("COMPLETED");
    expect((result.rootCause as any).finding).toBe("Service is healthy");

    const invocations = readInvocations(argsLog);
    expect(invocations.length).toBe(1);
    const args = invocations[0]!.split(" ");
    expect(args).toContain("-p");
    expect(args).toContain("ag_adaptive_test");
    expect(args).toContain("-z");
    expect(args).toContain("--ignore-rules");
  });

  it("reconstructs investigationNarrative into STEP/OBSERVATION events and emits ROOT_CAUSE", async () => {
    const scriptPath = writeFakeHermesScript({
      stdout: JSON.stringify({
        finding: "ECS tasks crash-looping",
        rootCause: "Container image tag does not exist in ECR.",
        confidence: 0.95,
        remediationTool: "aws_ecs_rollback_service",
        remediationParams: { cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" },
        riskLevel: "HIGH",
        requiresApproval: true,
        investigationNarrative: [
          "Described the ECS service and found runningCount below desiredCount.",
          "Checked stopped tasks and found CannotPullContainerError.",
          "Concluded the deployed image tag is missing from ECR."
        ]
      })
    });

    const adapter = new HermesAgentAdapter({ hermesBin: scriptPath, enableLiveInference: true });
    adapter.hermesProfileName = "ag_adaptive_test";
    const session = await startSession(adapter);

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    // HIGH risk routes through the registered tool call handler, exactly
    // like the fixed-script path — register one so the proposal doesn't hit
    // the class's own default handler.
    let handledCall: AgentToolCall | null = null;
    adapter.onToolCall(session.sessionId, async (call): Promise<AgentToolResult> => {
      handledCall = call;
      return { callId: call.callId, status: "AWAITING_APPROVAL", approvalId: "appr_test_001" };
    });

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    expect(events.some((e) => e.type === "STATUS" && (e.data as any).mode === "adaptive")).toBe(true);
    expect(events.filter((e) => e.type === "STEP").length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === "OBSERVATION").length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === "ROOT_CAUSE").length).toBe(1);
    expect(events.filter((e) => e.type === "PROPOSAL").length).toBe(1);

    expect(handledCall).not.toBeNull();
    expect(handledCall!.toolName).toBe("aws_ecs_rollback_service");
    expect(handledCall!.reasoning).toContain("ECS tasks crash-looping");

    expect(result.status).toBe("WAITING_APPROVAL");
    expect(result.approvalId).toBe("appr_test_001");
  });

  it("handles a final response with no investigationNarrative (no per-call reasoning to reconstruct) without failing", async () => {
    const scriptPath = writeFakeHermesScript({
      stdout: JSON.stringify({
        finding: "Service is healthy",
        rootCause: "No anomalies found.",
        confidence: 0.8,
        remediationTool: "aws_ecs_describe_services",
        remediationParams: { cluster: "cloudops-test", service: "starvision-motors", region: "us-east-1" },
        riskLevel: "LOW",
        requiresApproval: false
        // no investigationNarrative field at all — the MCP protocol carries
        // no per-call reasoning, and here Hermes's final answer didn't
        // narrate its own steps either.
      })
    });

    const adapter = new HermesAgentAdapter({ hermesBin: scriptPath, enableLiveInference: true });
    adapter.hermesProfileName = "ag_adaptive_test";
    const session = await startSession(adapter);

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const result = await adapter.runInvestigation(session.sessionId);

    expect(result.status).toBe("COMPLETED");
    expect((result.rootCause as any).finding).toBe("Service is healthy");
    expect(
      events.some(
        (e) => e.type === "OBSERVATION" && String((e.data as any).observation || "").includes("did not narrate")
      )
    ).toBe(true);
    expect(events.filter((e) => e.type === "ROOT_CAUSE").length).toBe(1);
  });

  it("falls back to the fixed-script investigation when the adaptive path's output is unparseable, and still produces a correct result", async () => {
    // Every executeHermesInference call (both the adaptive attempt and, if
    // the fixed path's own live-inference synthesis is reached) hits this
    // same fake binary — always returning non-JSON output, so neither can
    // succeed via the LLM and the fixed path must fall back to its own
    // grounded telemetry heuristics.
    const scriptPath = writeFakeHermesScript({ stdout: "This is not JSON at all." });

    const adapter = new HermesAgentAdapter({ hermesBin: scriptPath, enableLiveInference: true });
    adapter.hermesProfileName = "ag_adaptive_test";
    const session = await startSession(adapter);

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    // The fixed-script path's own fixed 3-step trace should be present —
    // proof the fallback actually ran end to end, not just that nothing
    // threw.
    expect(events.filter((e) => e.type === "STEP").length).toBeGreaterThanOrEqual(3);
    expect(events.filter((e) => e.type === "ROOT_CAUSE").length).toBe(1);
    expect(result.rootCause).toBeDefined();
    expect(typeof (result.rootCause as any).finding).toBe("string");
    expect((result.rootCause as any).finding.length).toBeGreaterThan(0);
    expect(["COMPLETED", "WAITING_APPROVAL"]).toContain(result.status);
  });

  it("does not attempt the adaptive path at all when hermesProfileName is unset (pre-Phase-B behavior unchanged)", async () => {
    const argsLog = makeArgsLogPath();
    const scriptPath = writeFakeHermesScript({
      argsLogPath: argsLog,
      stdout: JSON.stringify({
        finding: "irrelevant — fixed path decides synthesis independently",
        rootCause: "irrelevant",
        confidence: 0.5,
        remediationTool: "aws_ecs_describe_services",
        remediationParams: {},
        riskLevel: "LOW",
        requiresApproval: false
      })
    });

    const adapter = new HermesAgentAdapter({ hermesBin: scriptPath, enableLiveInference: true });
    // hermesProfileName deliberately left unset.
    const session = await startSession(adapter);

    await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-test",
      service: "starvision-motors",
      region: "us-east-1"
    });

    // Fixed path only invokes the LLM once, for root-cause synthesis, and
    // never passes -p since no profile is set.
    const invocations = readInvocations(argsLog);
    expect(invocations.length).toBe(1);
    expect(invocations[0]!.split(" ")).not.toContain("-p");
  });
});
