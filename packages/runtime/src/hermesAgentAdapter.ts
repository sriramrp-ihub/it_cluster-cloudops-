import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  type AgentAdapter,
  type AgentExecutionContext,
  type AgentSession,
  type AgentEvent,
  type AgentToolCall,
  type AgentToolResult,
  type InvestigationDriveContext,
  type InvestigationDriveResult
} from "./agentAdapter.js";
import {
  ValidationError,
  NotFoundError,
  validateIncidentContext,
  logger,
  sanitizeLogString
} from "@cloudops/shared";
import { resolveSwarmParticipants, type SwarmEligibility, type SwarmParticipant } from "./swarmRouting.js";
import { createSwarmChildRun, completeSwarmChildRun } from "./swarmRunTrace.js";

export function cleanLlmOutput(output: string): string {
  return output
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("[") && !trimmed.startsWith("DEBUG:") && !trimmed.startsWith("INFO:");
    })
    .join("\n")
    .trim();
}

export function extractJsonFromLlmOutput(output: string): any {
  const cleaned = cleanLlmOutput(output);
  const trimmed = cleaned.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {}
  }

  const findingIdx = trimmed.indexOf('"finding"');
  if (findingIdx !== -1) {
    const startBrace = trimmed.lastIndexOf("{", findingIdx);
    if (startBrace !== -1) {
      let depth = 0;
      let closingBrace = -1;
      for (let i = startBrace; i < trimmed.length; i++) {
        if (trimmed[i] === "{") depth++;
        else if (trimmed[i] === "}") {
          depth--;
          if (depth === 0) {
            closingBrace = i;
            break;
          }
        }
      }
      if (closingBrace !== -1) {
        try {
          return JSON.parse(trimmed.substring(startBrace, closingBrace + 1));
        } catch {}
      }
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonSub = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSub);
    } catch {}
  }

  return null;
}

export interface HermesAgentConfig {
  endpoint?: string | undefined;
  sessionToken?: string | undefined;
  timeoutMs?: number | undefined;
  hermesBin?: string | undefined;
  enableLiveInference?: boolean | undefined;
  agentName?: string | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  /** ADR-0008 Phase A: initial governed Hermes profile name, if known at construction time. */
  hermesProfileName?: string | undefined;
  /**
   * ADR-0007 Phase C1b: bounded per-stage timeout (poll-for-ready + claim +
   * oneshot inference + complete) for each swarm worker/verifier/synthesizer
   * task. Any stage that doesn't complete within this budget is a clean
   * failure that falls through to the adaptive tier — never a silent hang.
   * Defaults to 90s per the design's own sizing rationale (generous enough
   * for a real tool-calling turn, small enough to bound worst-case latency).
   */
  swarmStageTimeoutMs?: number | undefined;
  /**
   * ADR-0007 Phase C1b: swarm-eligibility resolver, injectable for tests
   * (defaults to the real `resolveSwarmParticipants`, which hits the real DB
   * and independently re-verifies governance live — see swarmRouting.ts).
   */
  resolveSwarmEligibility?: ((tenantId: string) => Promise<SwarmEligibility>) | undefined;
}

export class HermesAgentAdapter implements AgentAdapter {
  readonly adapterType = "hermes";
  readonly protocol = "acp" as const;

  private sessions = new Map<string, AgentSession>();
  private eventListeners = new Map<string, Set<(event: AgentEvent) => void>>();
  private toolCallHandlers = new Map<
    string,
    (call: AgentToolCall) => Promise<AgentToolResult>
  >();

  private endpoint: string;
  private sessionToken: string;
  private timeoutMs: number;
  private hermesBin: string;
  private enableLiveInference: boolean;
  public agentName?: string | undefined;
  public activeModel?: string | undefined;
  public activeProvider?: string | undefined;
  /**
   * ADR-0008 Phase A: the agent's own governed Hermes profile name (see
   * HermesProfileService), set dynamically per request exactly like
   * `agentName`/`activeModel` above (see apps/api's investigations.ts
   * `applyGovernedProfile()` and agents.ts chat route). Left undefined by
   * default — every existing caller that never sets this keeps talking to
   * the shared/default profile exactly as before this ADR; this is a purely
   * additive, opt-in behavior change.
   */
  public hermesProfileName?: string | undefined;
  /** ADR-0007 Phase C1b: see HermesAgentConfig.swarmStageTimeoutMs. */
  private readonly swarmStageTimeoutMs: number;
  /** ADR-0007 Phase C1b: see HermesAgentConfig.resolveSwarmEligibility. */
  private readonly resolveSwarmEligibility: (tenantId: string) => Promise<SwarmEligibility>;

  constructor(config: HermesAgentConfig = {}) {
    this.endpoint = config.endpoint || process.env.HERMES_URL || "http://127.0.0.1:8080";
    this.sessionToken =
      config.sessionToken ||
      process.env.HERMES_SESSION_TOKEN ||
      "";
    this.timeoutMs = config.timeoutMs || 10000;
    this.hermesBin =
      config.hermesBin ||
      process.env.HERMES_BIN ||
      "hermes";
    this.enableLiveInference =
      config.enableLiveInference ?? (process.env.HERMES_LIVE_INFERENCE !== "false");
    this.agentName = config.agentName;
    this.activeModel = config.model;
    this.activeProvider = config.provider;
    this.hermesProfileName = config.hermesProfileName;
    this.swarmStageTimeoutMs = config.swarmStageTimeoutMs ?? 90000;
    this.resolveSwarmEligibility = config.resolveSwarmEligibility || resolveSwarmParticipants;
  }

  /**
   * Dynamically sets the runtime daemon endpoint and session token in real time
   */
  public setEndpoint(endpoint: string, sessionToken?: string): void {
    if (endpoint && endpoint.trim().length > 0) {
      this.endpoint = endpoint.trim();
    }
    if (sessionToken !== undefined) {
      this.sessionToken = sessionToken.trim();
    }
  }

  /**
   * Returns current effective endpoint
   */
  public getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Probes the live Hermes daemon for health and active model metadata dynamically.
   * If the current endpoint fails, dynamically tests alternative local and container bridge candidates.
   */
  async checkHermesHealth(): Promise<{
    connected: boolean;
    endpoint: string;
    model?: string;
    provider?: string;
    error?: string;
  }> {
    const candidates = Array.from(
      new Set([
        this.endpoint,
        "http://127.0.0.1:8080",
        "http://host.docker.internal:8080"
      ].filter(Boolean))
    );

    let lastError = "Hermes daemon unreachable";

    for (const candidate of candidates) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(`${candidate}/api/model/auxiliary`, {
          headers: {
            "X-Hermes-Session-Token": this.sessionToken
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = (await res.json()) as any;
          const discoveredModel = data?.main?.model || this.activeModel || "agent-runtime";
          const discoveredProvider = data?.main?.provider || this.activeProvider || "local-daemon";
          this.activeModel = discoveredModel;
          this.activeProvider = discoveredProvider;
          this.endpoint = candidate; // Dynamically adopt working endpoint
          return {
            connected: true,
            endpoint: this.endpoint,
            model: discoveredModel,
            provider: discoveredProvider
          };
        }
        lastError = `Hermes daemon responded with HTTP ${res.status}`;
      } catch (err: any) {
        lastError = err?.message || "Hermes daemon unreachable";
      }
    }

    return {
      connected: false,
      endpoint: this.endpoint,
      error: lastError
    };
  }

  /**
   * Executes live LLM inference using the local Hermes agent
   */
  async executeHermesInference(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs || this.timeoutMs || 30000;
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    // ADR-0008 Phase A: when this.hermesProfileName is set (a governed,
    // verified-LOCKED_DOWN profile — see HermesProfileService and
    // investigations.ts's applyGovernedProfile()), every inference call
    // this agent's session makes runs against ITS OWN isolated profile
    // (`-p <profile>`) instead of the shared default one — real per-agent
    // isolation, not a per-tenant convention layered on shared state.
    // Unset (the default for every caller that predates this ADR), this is
    // byte-for-byte the same invocation as before.
    const profileArgs = this.hermesProfileName ? ["-p", this.hermesProfileName] : [];

    const { stdout } = await execFileAsync(
      this.hermesBin,
      // History here: "-t ''" (empty toolsets) doesn't mean "load nothing" —
      // Hermes treats an empty string as unset and loads every installed
      // personal-assistant plugin anyway. The next fix, --safe-mode, solved
      // the latency but also silently dropped the configured model/provider
      // (it implies --ignore-user-config). The real source of the slowdown
      // was one specific *enabled* plugin (servicenow_pipeline) being fully
      // loaded on every call — disabled persistently via `hermes plugins
      // disable servicenow_pipeline`, a one-time config change, not a
      // per-call flag. That leaves --ignore-rules as the only flag still
      // needed here: it skips Hermes's own AGENTS.md/memory/skill injection,
      // which is deliberate, not a leftover workaround — that memory lives
      // in one global file shared by every tenant this process ever talks
      // to (~/.hermes/memories/USER.md), so injecting it here would leak
      // one tenant's facts into another's chat responses. Real per-tenant
      // memory is CloudOps' own concern (see tenantMemoryService), not
      // Hermes's.
      [...profileArgs, "-z", prompt, "--ignore-rules"],
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env }
      }
    );

    const cleaned = cleanLlmOutput(stdout);
    // Phase 3.8: the subprocess above inherits the full process environment
    // (DATABASE_URL, REDIS_ENCRYPTION_KEY, DEFENSECLAW_GATEWAY_TOKEN, and any
    // future cloud credentials) — the model has no business echoing any of
    // it back, but nothing stops it from trying (prompt injection or plain
    // accident). This is the single choke point every caller of live LLM
    // inference goes through (investigation root-cause synthesis, the
    // operator chat endpoint), so redacting here covers both without either
    // caller having to remember to.
    return sanitizeLogString(cleaned || stdout.trim());
  }

  async start(context: AgentExecutionContext): Promise<AgentSession> {
    if (!context.tenantId) {
      throw new ValidationError("Cannot start agent session: tenantId is required");
    }
    if (!context.agentId) {
      throw new ValidationError("Cannot start agent session: agentId is required");
    }

    if (context.incidentContext !== undefined) {
      const validation = validateIncidentContext(context.incidentContext);
      if (!validation.valid) {
        throw new ValidationError(`Invalid incident context: ${validation.errors?.join("; ")}`);
      }
    }

    // Verify Hermes daemon reachability
    const health = await this.checkHermesHealth();
    if (!health.connected) {
      logger.warn(
        { endpoint: this.endpoint, error: health.error },
        "Hermes daemon check warning: proceeding with local execution loop"
      );
    }

    const sessionId = `sess_${randomUUID()}`;
    const session: AgentSession = {
      sessionId,
      agentId: context.agentId,
      tenantId: context.tenantId,
      status: "ACTIVE",
      startedAt: new Date(),
      currentStep: 0,
      evidenceCollected: []
    };

    this.sessions.set(sessionId, session);
    this.eventListeners.set(sessionId, new Set());

    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: {
        status: "ACTIVE",
        agentType: "hermes",
        model: health.model || this.activeModel || "agent-runtime",
        provider: health.provider || this.activeProvider || "local-daemon",
        message: `Hermes Live Agent connected on ${this.endpoint}`
      }
    });

    return session;
  }

  onEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void {
    const listeners = this.eventListeners.get(sessionId);
    if (!listeners) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  onToolCall(
    sessionId: string,
    callback: (call: AgentToolCall) => Promise<AgentToolResult>
  ): () => void {
    if (!this.sessions.has(sessionId)) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }
    this.toolCallHandlers.set(sessionId, callback);
    return () => {
      this.toolCallHandlers.delete(sessionId);
    };
  }

  async terminate(sessionId: string, reason: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    session.status = "TERMINATED";
    session.terminatedAt = new Date();
    session.disconnectReason = reason;

    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: { status: "TERMINATED", reason }
    });
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * ADR-0008 Phase B (§4.1): drives one full investigation turn. When this
   * agent has its own governed Hermes profile (`this.hermesProfileName` —
   * only ever set once `HermesProfileService` has independently verified
   * `governance_status === 'LOCKED_DOWN'`, see investigations.ts's
   * `applyGovernedProfile()`), first tries letting Hermes's own tool-calling
   * loop drive the investigation adaptively against that profile's one MCP
   * server, instead of walking the fixed 3-step script. ANY failure in that
   * path — inference error, timeout, unparseable output, missing required
   * fields — is caught here and falls through to the exact same fixed-script
   * path used when there's no governed profile at all. This preserves the
   * pre-Phase-B behavior as a safety net: a broken or unreachable adaptive
   * loop degrades to today's grounded, deterministic investigation, it never
   * surfaces as a failed investigation the caller has to handle specially.
   */
  async runInvestigation(
    sessionId: string,
    incidentContext?: InvestigationDriveContext
  ): Promise<InvestigationDriveResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    // ADR-0007 Phase C1b: tier 0, tried before Phase B's adaptive tier.
    // Opt-in strictly at the fleet-composition level — resolveSwarmEligibility
    // (real impl: resolveSwarmParticipants) returns eligible:false with zero
    // side effects for every tenant that hasn't deliberately onboarded a
    // role-tagged fleet (i.e. everyone today), so this branch is a pure
    // no-op for them. ANY failure once inside the swarm attempt (CLI error,
    // stage timeout, unparseable stage output) is caught here and falls
    // through to the adaptive tier exactly like that tier already falls
    // through to the fixed script — the swarm tier is a new rung on the same
    // fail-safe ladder, not a special case with its own failure handling.
    try {
      const swarmEligibility = await this.resolveSwarmEligibility(session.tenantId);
      if (swarmEligibility.eligible) {
        try {
          return await this.runSwarmInvestigation(sessionId, incidentContext, swarmEligibility);
        } catch (err) {
          logger.warn(
            { err, sessionId, tenantId: session.tenantId },
            "Swarm investigation failed, falling back to adaptive/fixed-script investigation"
          );
        }
      }
    } catch (err) {
      logger.warn(
        { err, sessionId, tenantId: session.tenantId },
        "Swarm eligibility resolution failed, falling back to adaptive/fixed-script investigation"
      );
    }

    if (this.hermesProfileName) {
      try {
        return await this.runAdaptiveInvestigation(sessionId, incidentContext);
      } catch (err) {
        logger.warn(
          { err, sessionId, hermesProfileName: this.hermesProfileName },
          "Adaptive investigation loop failed, falling back to grounded fixed-script investigation"
        );
      }
    }

    return this.runFixedScriptInvestigation(sessionId, incidentContext);
  }

  // ── ADR-0007 Phase C1b: Kanban Swarm CLI plumbing ─────────────────────

  /**
   * Runs `hermes kanban <args...>`. Mirrors HermesProfileService's own
   * `runHermes()` convention exactly: never throws for a clean process exit
   * (even non-zero) since `hermes kanban claim`/`promote` on a task whose
   * dependencies aren't actually satisfied print a plain "cannot claim ..."
   * message and still exit 0 (live-verified this session — see this
   * feature's design notes) — callers must parse stdout, never branch on
   * exit code. Only throws when the CLI itself couldn't be run at all
   * (binary missing, killed by timeout).
   */
  private runKanbanCli(args: string[], timeoutMs = 20000): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      execFile(
        this.hermesBin,
        ["kanban", ...args],
        { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, env: { ...process.env } },
        (err: any, stdout, stderr) => {
          const stdoutStr = stdout?.toString() ?? "";
          const stderrStr = stderr?.toString() ?? "";
          if (err) {
            if (typeof err.code === "number") {
              resolve({ stdout: stdoutStr, stderr: stderrStr, code: err.code });
              return;
            }
            reject(new Error(`Hermes kanban CLI invocation failed (kanban ${args.join(" ")}): ${err?.message || err}`));
            return;
          }
          resolve({ stdout: stdoutStr, stderr: stderrStr, code: 0 });
        }
      );
    });
  }

  /**
   * Runs one oneshot Hermes inference turn against an EXPLICIT profile,
   * independent of `this.hermesProfileName` — unlike `executeHermesInference()`
   * (which reads that shared instance field), swarm workers run genuinely in
   * parallel against DIFFERENT profiles, so this must never touch shared
   * mutable adapter state. Otherwise identical invocation shape
   * (`-p <profile> -z <prompt> --ignore-rules`) and the same redaction of
   * anything the model might echo back from its inherited process
   * environment.
   */
  private runHermesOneshotForProfile(profileName: string, prompt: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.hermesBin,
        ["-p", profileName, "-z", prompt, "--ignore-rules"],
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
        (err: any, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `Swarm oneshot inference failed for profile '${profileName}': ${err?.message || err}${stderr ? ` (${stderr.toString().slice(0, 500)})` : ""}`
              )
            );
            return;
          }
          const stdoutStr = stdout?.toString() ?? "";
          const cleaned = cleanLlmOutput(stdoutStr);
          resolve(sanitizeLogString(cleaned || stdoutStr.trim()));
        }
      );
    });
  }

  /**
   * Polls `hermes kanban show <taskId> --json` until the task's status flips
   * to 'ready' (or a terminal 'done'/'archived' status, treated as already
   * satisfied), bounded by `timeoutMs`. Live-verified this session: a
   * dependent task (verifier/synthesizer) genuinely sits at 'todo' until
   * EVERY parent task is `complete`d, at which point it flips to 'ready' via
   * a pure DB-level transition — no `hermes gateway` dispatcher daemon
   * required for this manual/synchronous claim→run→complete flow. Throws
   * (never hangs silently) on a 'blocked' status or on timeout — either is a
   * clean failure the caller's try/catch turns into a fall-through to the
   * adaptive tier.
   */
  private async waitForKanbanTaskReady(taskId: string, timeoutMs: number, pollIntervalMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { stdout } = await this.runKanbanCli(["show", taskId, "--json"]);
      let parsed: any = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // keep polling — a transient unparseable response isn't necessarily terminal
      }
      const status = parsed?.task?.status;
      if (status === "ready" || status === "done" || status === "archived") {
        return;
      }
      if (status === "blocked") {
        throw new Error(`Swarm task ${taskId} is blocked, cannot proceed: ${stdout}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Swarm task ${taskId} did not become ready within ${timeoutMs}ms (status: ${status ?? "unknown"})`);
      }
      await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
    }
  }

  /**
   * ADR-0007 Phase C1b: tier 0 of `runInvestigation()`'s fallback chain — a
   * Kanban-Swarm-orchestrated investigation across N real, onboarded,
   * independently-governed CloudOps agents (>= 1 'investigator' + exactly
   * one 'verifier' + one 'synthesizer' — see swarmRouting.ts). This is
   * honestly "CloudOps re-implements a thin manual dispatcher over kanban's
   * atomic claim primitive," not "we use Hermes's full auto-dispatch swarm
   * feature": one `hermes kanban swarm ... --json` call builds the
   * dependency graph, then THIS Node process drives each stage to
   * completion itself via ordinary `execFile` calls (poll for ready → claim
   * → run one oneshot inference turn against that stage's OWN governed
   * Hermes profile → complete), never `hermes gateway`/the daemon dispatcher
   * (a machine-wide singleton — the wrong dependency for a synchronous,
   * on-demand feature per this design's own rationale).
   *
   * Every tool call any worker/verifier/synthesizer profile makes happens
   * INSIDE that profile's own Hermes tool-calling loop against ITS OWN
   * governed MCP registration (`cloudops-control-plane`) — exactly like
   * Phase B's adaptive tier, this TypeScript process never sees individual
   * tool calls, and every one of them still goes through the exact same
   * CloudOpsMcpServer/PolicyEngine.evaluate() choke point every other call in
   * this system uses (no shortcut, no second code path). `role` is never
   * part of that evaluation — it only decided WHICH already-governed profile
   * got assigned to WHICH slot in the graph.
   *
   * Worker split mirrors the pre-swarm fixed 3-step script's own tool
   * choices — aws_ecs_describe_services / aws_cloudwatch_get_metric_data /
   * aws_ecs_describe_stopped_tasks — now genuinely parallel (Promise.all)
   * and independently verified by a dedicated verifier stage before the
   * synthesizer ever sees them. When fewer than 3 'investigator' agents are
   * available, the 3 fixed tool assignments cycle through whichever
   * investigator profiles ARE available (a swarm worker card is just
   * PROFILE:TITLE — nothing prevents the same profile from holding two
   * worker cards with different titles/tools).
   *
   * The synthesizer's final output is parsed via the exact same
   * `extractJsonFromLlmOutput()` used everywhere else in this file, against
   * the EXACT SAME JSON schema `runAdaptiveInvestigation()`'s prompt
   * specifies (finding/rootCause/confidence/remediationTool/
   * remediationParams/riskLevel/requiresApproval/investigationNarrative) —
   * no second schema invented for this tier. ANY failure at any stage
   * (unparseable worker/verifier/synthesizer output, a claim that never
   * succeeds, a stage that doesn't become ready within
   * `this.swarmStageTimeoutMs`) throws and is caught by `runInvestigation()`'s
   * own try/catch, falling through to the adaptive tier — never a silent
   * hang, never a partially-synthesized result presented as final.
   */
  private async runSwarmInvestigation(
    sessionId: string,
    incidentContext: InvestigationDriveContext | undefined,
    swarm: SwarmEligibility
  ): Promise<InvestigationDriveResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }
    if (!swarm.eligible || !swarm.verifier || !swarm.synthesizer || swarm.investigators.length < 1) {
      // Defensive — callers must only invoke this with an eligible() result.
      throw new Error("runSwarmInvestigation invoked with a non-eligible SwarmEligibility result");
    }

    const targetCluster = incidentContext?.cluster || "cloudops-test";
    const targetService = incidentContext?.service || "starvision-motors";
    const targetRegion = incidentContext?.region || "us-east-1";
    const alertDescription = incidentContext?.alertDescription || "ECS service health anomaly";
    const parentRunId = incidentContext?.runId ?? null;
    const stageTimeoutMs = this.swarmStageTimeoutMs;

    session.currentStep = 1;
    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: {
        status: "ACTIVE",
        mode: "swarm",
        message: `Dispatching Kanban Swarm across ${swarm.investigators.length} investigator(s), 1 verifier, and 1 synthesizer.`
      }
    });
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: 1, toolName: "hermes_kanban_swarm_create", status: "running" }
    });

    const goal = `Investigate ECS service health incident. Service="${targetService}" Cluster="${targetCluster}" Region="${targetRegion}". Alert: ${alertDescription}`;

    const workerToolPlan: Array<{ tool: string; title: string; instruction: string }> = [
      {
        tool: "aws_ecs_describe_services",
        title: "Investigate ECS service status",
        instruction: `Call the "aws_ecs_describe_services" tool for service "${targetService}" in cluster "${targetCluster}" (region "${targetRegion}") and assess baseline service health (desired/running/pending task counts, deployment rollout state).`
      },
      {
        tool: "aws_cloudwatch_get_metric_data",
        title: "Investigate correlated CloudWatch metrics",
        instruction: `Call the "aws_cloudwatch_get_metric_data" tool for service "${targetService}" in cluster "${targetCluster}" (region "${targetRegion}") and check for a correlated metric anomaly (e.g. 5xx spike).`
      },
      {
        tool: "aws_ecs_describe_stopped_tasks",
        title: "Investigate recently stopped tasks",
        instruction: `Call the "aws_ecs_describe_stopped_tasks" tool for service "${targetService}" in cluster "${targetCluster}" (region "${targetRegion}") and inspect recently stopped tasks for a concrete container-level failure signal.`
      }
    ];
    const workerAssignments = workerToolPlan.map((plan, idx) => ({
      ...plan,
      participant: swarm.investigators[idx % swarm.investigators.length]!
    }));

    const kanbanArgs = [
      "swarm",
      goal,
      ...workerAssignments.flatMap((w) => ["--worker", `${w.participant.hermesProfileName}:${w.title}`]),
      "--verifier",
      swarm.verifier.hermesProfileName,
      "--synthesizer",
      swarm.synthesizer.hermesProfileName,
      "--tenant",
      session.tenantId,
      "--json"
    ];

    const swarmCreate = await this.runKanbanCli(kanbanArgs, 20000);
    let topology: any;
    try {
      topology = JSON.parse(swarmCreate.stdout);
    } catch {
      throw new Error(`'hermes kanban swarm' did not return parseable JSON: ${swarmCreate.stdout || swarmCreate.stderr}`);
    }
    if (
      !Array.isArray(topology?.worker_ids) ||
      topology.worker_ids.length !== workerAssignments.length ||
      !topology.verifier_id ||
      !topology.synthesizer_id
    ) {
      throw new Error(`Unexpected 'hermes kanban swarm' output shape: ${swarmCreate.stdout}`);
    }

    // ── Worker stage: genuinely parallel (Promise.all), each independently
    // claimed/run/completed against its own profile and its own tool. ──────
    let stepCursor = 2;
    const workerResults = await Promise.all(
      workerAssignments.map(async (assignment, idx) => {
        const taskId: string = topology.worker_ids[idx];
        const stepNum = stepCursor + idx;
        this.emitEvent(sessionId, {
          type: "STEP",
          sessionId,
          timestamp: new Date(),
          data: {
            step: stepNum,
            toolName: `swarm_investigator:${assignment.tool}`,
            status: "running",
            assignee: assignment.participant.agentId
          }
        });

        const childRunId = await createSwarmChildRun({
          tenantId: session.tenantId,
          agentId: assignment.participant.agentId,
          parentRunId,
          userPrompt: assignment.instruction
        });

        try {
          await this.waitForKanbanTaskReady(taskId, stageTimeoutMs);
          const claim = await this.runKanbanCli(["claim", taskId]);
          if (!/Claimed/i.test(claim.stdout)) {
            throw new Error(`Failed to claim swarm worker task ${taskId}: ${claim.stdout || claim.stderr}`);
          }

          const workerPrompt = `You are a CloudOps swarm investigation worker. ${assignment.instruction}

Once you are done — this must be your FINAL message, after you've finished calling the tool — respond with ONLY valid JSON (no markdown, no backticks, no other text) conforming to this schema:
{
  "domainFinding": "<concise 1-2 sentence finding from this specific tool call>",
  "evidence": "<the concrete data point(s) that support this finding>",
  "narrative": "<one short sentence describing what you did and learned>"
}`;

          const rawOutput = await this.runHermesOneshotForProfile(assignment.participant.hermesProfileName, workerPrompt, stageTimeoutMs);
          const parsed = extractJsonFromLlmOutput(rawOutput);
          if (!parsed || typeof parsed.domainFinding !== "string") {
            throw new Error(`Swarm worker ${taskId} (${assignment.tool}) returned unparseable output`);
          }

          await this.runKanbanCli([
            "complete",
            taskId,
            "--result",
            JSON.stringify(parsed),
            "--summary",
            String(parsed.domainFinding).slice(0, 200)
          ]);

          this.emitEvent(sessionId, {
            type: "OBSERVATION",
            sessionId,
            timestamp: new Date(),
            data: {
              step: stepNum,
              toolName: `swarm_investigator:${assignment.tool}`,
              observation: parsed.domainFinding,
              evidence: parsed.evidence
            }
          });

          await completeSwarmChildRun(childRunId, "COMPLETED", JSON.stringify(parsed));
          return { tool: assignment.tool, ...parsed } as { tool: string; domainFinding: string; evidence?: unknown; narrative?: string };
        } catch (err: any) {
          await completeSwarmChildRun(childRunId, "FAILED", err?.message || String(err));
          throw err;
        }
      })
    );
    stepCursor += workerAssignments.length;

    // ── Verifier stage ──────────────────────────────────────────────────
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: stepCursor, toolName: "swarm_verifier", status: "running", assignee: swarm.verifier.agentId }
    });

    const verifierChildRunId = await createSwarmChildRun({
      tenantId: session.tenantId,
      agentId: swarm.verifier.agentId,
      parentRunId,
      userPrompt: `Verify ${workerResults.length} swarm worker finding(s) for incident: ${goal}`
    });

    let verifierParsed: any;
    try {
      await this.waitForKanbanTaskReady(topology.verifier_id, stageTimeoutMs);
      const verifierClaim = await this.runKanbanCli(["claim", topology.verifier_id]);
      if (!/Claimed/i.test(verifierClaim.stdout)) {
        throw new Error(`Failed to claim swarm verifier task ${topology.verifier_id}: ${verifierClaim.stdout || verifierClaim.stderr}`);
      }

      const verifierPrompt = `You are a CloudOps swarm investigation verifier. Review the following worker findings for incident: ${goal}

${workerResults.map((w, i) => `Worker ${i + 1} (${w.tool}): finding="${w.domainFinding}" evidence=${JSON.stringify(w.evidence ?? null)}`).join("\n")}

Cross-check these findings against each other for consistency. Once done, respond with ONLY valid JSON (no markdown, no backticks, no other text) conforming to this schema:
{
  "verifiedFindings": ["<each worker finding you consider corroborated>"],
  "flaggedInconsistencies": ["<any contradiction or unsupported claim you found, empty array if none>"],
  "overallConfidence": <number between 0.0 and 1.0>
}`;

      const verifierRaw = await this.runHermesOneshotForProfile(swarm.verifier.hermesProfileName, verifierPrompt, stageTimeoutMs);
      verifierParsed = extractJsonFromLlmOutput(verifierRaw);
      if (!verifierParsed || !Array.isArray(verifierParsed.verifiedFindings)) {
        throw new Error(`Swarm verifier ${topology.verifier_id} returned unparseable output`);
      }

      const gate = (verifierParsed.flaggedInconsistencies?.length ?? 0) === 0 ? "pass" : "flagged";
      await this.runKanbanCli([
        "complete",
        topology.verifier_id,
        "--result",
        JSON.stringify(verifierParsed),
        "--metadata",
        JSON.stringify({ gate })
      ]);

      this.emitEvent(sessionId, {
        type: "OBSERVATION",
        sessionId,
        timestamp: new Date(),
        data: {
          step: stepCursor,
          toolName: "swarm_verifier",
          observation: `Verifier reviewed ${workerResults.length} worker finding(s); overallConfidence=${verifierParsed.overallConfidence}; gate=${gate}.`
        }
      });

      await completeSwarmChildRun(verifierChildRunId, "COMPLETED", JSON.stringify(verifierParsed));
    } catch (err: any) {
      await completeSwarmChildRun(verifierChildRunId, "FAILED", err?.message || String(err));
      throw err;
    }
    stepCursor += 1;

    // ── Synthesizer stage — the ONLY stage whose output becomes the final
    // InvestigationDriveResult, using the EXACT SAME schema
    // runAdaptiveInvestigation()'s prompt specifies. ───────────────────────
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: stepCursor, toolName: "swarm_synthesizer", status: "running", assignee: swarm.synthesizer.agentId }
    });

    const synthesizerChildRunId = await createSwarmChildRun({
      tenantId: session.tenantId,
      agentId: swarm.synthesizer.agentId,
      parentRunId,
      userPrompt: `Synthesize verified swarm findings for incident: ${goal}`
    });

    let parsed: any;
    try {
      await this.waitForKanbanTaskReady(topology.synthesizer_id, stageTimeoutMs);
      const synthClaim = await this.runKanbanCli(["claim", topology.synthesizer_id]);
      if (!/Claimed/i.test(synthClaim.stdout)) {
        throw new Error(`Failed to claim swarm synthesizer task ${topology.synthesizer_id}: ${synthClaim.stdout || synthClaim.stderr}`);
      }

      const synthesizerPrompt = `You are the CloudOps swarm investigation synthesizer, producing the FINAL result for incident: ${goal}

Verified worker findings:
${workerResults.map((w, i) => `Worker ${i + 1} (${w.tool}): "${w.domainFinding}" (evidence: ${JSON.stringify(w.evidence ?? null)})`).join("\n")}

Verifier assessment: verifiedFindings=${JSON.stringify(verifierParsed.verifiedFindings)}, flaggedInconsistencies=${JSON.stringify(verifierParsed.flaggedInconsistencies)}, overallConfidence=${verifierParsed.overallConfidence}

Available remediation tools:
- "aws_ecs_rollback_service": Use if deployment failed, container crashed on startup, or bad image tag was deployed.
- "aws_ecs_update_service_image": Use if a specific image tag needs updating.
- "aws_ecs_update_service": Use if task counts or service definition need forced update.
- "aws_ecs_describe_services": Use if no failure is detected (informational only).

Synthesize the root cause and choose the safest remediation action. Respond with ONLY valid JSON (no markdown, no backticks, no other text) conforming to this schema:
{
  "finding": "<concise 1-2 sentence finding summary>",
  "rootCause": "<detailed technical root cause explanation>",
  "confidence": <number between 0.0 and 1.0>,
  "remediationTool": "<tool name>",
  "remediationParams": { "cluster": "${targetCluster}", "service": "${targetService}", "region": "${targetRegion}" },
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "requiresApproval": <boolean>,
  "investigationNarrative": ["<one short sentence per worker/verifier step, in order>"]
}`;

      const synthRaw = await this.runHermesOneshotForProfile(swarm.synthesizer.hermesProfileName, synthesizerPrompt, stageTimeoutMs);
      parsed = extractJsonFromLlmOutput(synthRaw);
      if (!parsed || !parsed.finding || !parsed.rootCause) {
        throw new Error("Swarm synthesizer did not return a parseable finding/rootCause JSON response");
      }

      await this.runKanbanCli([
        "complete",
        topology.synthesizer_id,
        "--result",
        JSON.stringify(parsed),
        "--summary",
        String(parsed.finding).slice(0, 200)
      ]);

      await completeSwarmChildRun(synthesizerChildRunId, "COMPLETED", JSON.stringify(parsed));
    } catch (err: any) {
      await completeSwarmChildRun(synthesizerChildRunId, "FAILED", err?.message || String(err));
      throw err;
    }

    // ── Reconstruct the same ROOT_CAUSE/PROPOSAL event shapes + approval
    // gating the adaptive/fixed-script tiers already emit — no UI contract
    // change, just role-labeled toolNames and more events. ────────────────
    const finding: string = parsed.finding;
    const rootCauseText: string = parsed.rootCause;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.85;
    const remediationToolName: string = parsed.remediationTool || "aws_ecs_describe_services";
    const remediationParams: Record<string, unknown> =
      parsed.remediationParams && typeof parsed.remediationParams === "object"
        ? parsed.remediationParams
        : { cluster: targetCluster, service: targetService, region: targetRegion };
    let riskLevel: string = parsed.riskLevel ? String(parsed.riskLevel).toUpperCase() : "LOW";
    if (
      (remediationToolName.includes("rollback") ||
        remediationToolName.includes("update") ||
        remediationToolName.includes("remediate")) &&
      riskLevel !== "CRITICAL"
    ) {
      riskLevel = "HIGH";
    }

    const narrative: string[] = Array.isArray(parsed.investigationNarrative)
      ? parsed.investigationNarrative.filter((line: unknown): line is string => typeof line === "string" && line.trim().length > 0)
      : [];
    narrative.forEach((line, idx) => {
      this.emitEvent(sessionId, {
        type: "OBSERVATION",
        sessionId,
        timestamp: new Date(),
        data: { step: stepCursor + 1 + idx, toolName: "swarm_synthesizer", observation: line }
      });
    });

    const evidenceCollected = session.evidenceCollected || [];
    const rootCause = {
      finding,
      rootCause: rootCauseText,
      confidence,
      evidenceIds: evidenceCollected,
      citedRunbooks: [],
      affectedResources: [`arn:aws:ecs:${targetRegion}:*:service/${targetCluster}/${targetService}`],
      dataSource: `live:${this.adapterType}:swarm`,
      recommendedRemediation: {
        toolName: remediationToolName,
        parameters: remediationParams,
        riskLevel,
        requiresApproval: riskLevel === "HIGH" || riskLevel === "CRITICAL"
      }
    };

    this.emitEvent(sessionId, {
      type: "ROOT_CAUSE",
      sessionId,
      timestamp: new Date(),
      data: rootCause
    });

    const handler =
      this.toolCallHandlers.get(sessionId) ||
      (async (call: AgentToolCall): Promise<AgentToolResult> => ({
        callId: call.callId,
        status: "SUCCESS",
        data: { status: "INSPECTED", timestamp: new Date().toISOString() }
      }));

    if (riskLevel === "HIGH" || riskLevel === "CRITICAL") {
      this.emitEvent(sessionId, {
        type: "PROPOSAL",
        sessionId,
        timestamp: new Date(),
        data: {
          toolName: remediationToolName,
          remediation: rootCause.recommendedRemediation,
          status: "AWAITING_APPROVAL"
        }
      });

      const proposalCall: AgentToolCall = {
        callId: `call_${randomUUID()}`,
        toolName: remediationToolName,
        arguments: remediationParams,
        timestamp: new Date(),
        reasoning: `${finding} ${rootCauseText}`.trim(),
        evidenceRefs: [...evidenceCollected]
      };

      const proposalResult = await handler(proposalCall);

      if (proposalResult.status === "AWAITING_APPROVAL") {
        session.status = "WAITING_APPROVAL";
        session.pendingApprovalId = proposalResult.approvalId;
      } else {
        session.status = "COMPLETED";
      }
    } else {
      session.status = "COMPLETED";
    }

    session.evidenceCollected = evidenceCollected;

    return {
      status: session.status,
      rootCause,
      approvalId: session.pendingApprovalId || undefined
    };
  }

  /**
   * ADR-0008 Phase B (§4.2): the Hermes-driven adaptive investigation loop.
   * Builds ONE task prompt describing the incident and asks Hermes to
   * investigate using whatever tools its governed profile has — its own MCP
   * server, `cloudops-control-plane` (see HermesProfileService) — deciding
   * itself what to check and in what order, then calls
   * `executeHermesInference()` exactly once with `this.hermesProfileName`
   * set, so it runs `-p <profile> -z "<prompt>" --ignore-rules`. Per the
   * ADR-0008 Phase B design notes §3, `-z` (oneshot) is understood to run
   * Hermes's normal multi-turn tool-calling loop and only suppress the CLI's
   * own turn-by-turn chrome from stdout — this is what makes the
   * investigation adaptive rather than a hardcoded script, but it also means
   * this TypeScript process has NO visibility into individual tool calls
   * Hermes makes along the way (they go straight from Hermes to
   * CloudOpsMcpServer over SSE, never through this adapter) until the final
   * response comes back.
   *
   * Emits the same AgentEvent shapes (STEP/OBSERVATION/EVIDENCE/ROOT_CAUSE/
   * PROPOSAL) the fixed-script path emits, so the web UI needs no changes —
   * just a variable count instead of a fixed 3, reconstructed from Hermes's
   * own `investigationNarrative` in its final JSON (see the class-level note
   * on why: the MCP protocol has no per-call reasoning field to capture
   * live). HIGH/CRITICAL risk findings still go through the exact same
   * `handler()`/approval-creation path the fixed-script path uses — Phase B
   * changes how the investigation decides what to check, not what's allowed
   * to execute unapproved.
   */
  private async runAdaptiveInvestigation(
    sessionId: string,
    incidentContext?: InvestigationDriveContext
  ): Promise<InvestigationDriveResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    const handler =
      this.toolCallHandlers.get(sessionId) ||
      (async (call: AgentToolCall): Promise<AgentToolResult> => ({
        callId: call.callId,
        status: "SUCCESS",
        data: { status: "INSPECTED", timestamp: new Date().toISOString() }
      }));

    const targetCluster = incidentContext?.cluster || "cloudops-test";
    const targetService = incidentContext?.service || "starvision-motors";
    const targetRegion = incidentContext?.region || "us-east-1";

    session.currentStep = 1;
    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: {
        status: "ACTIVE",
        mode: "adaptive",
        message: `Delegating investigation to Hermes's own tool-calling loop via governed profile '${this.hermesProfileName}'.`
      }
    });
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: 1, toolName: "hermes_adaptive_investigation", status: "running" }
    });

    if (!this.activeModel) {
      await this.checkHermesHealth();
    }
    const effectiveModel = this.activeModel || "agent-runtime";
    const effectiveAgentName = this.agentName || "CloudOps Autonomous SRE Agent";

    const prompt = `You are ${effectiveAgentName} (${effectiveModel}), investigating a real production incident using the tools available to you.

Incident:
- Service: "${targetService}"
- Cluster: "${targetCluster}"
- Region: "${targetRegion}"
- Alert: ${incidentContext?.alertDescription || "ECS service health anomaly"}

Investigate this incident using your available tools — check service health, correlated metrics, and recent task/container failures as you judge relevant, in whatever order and however many calls you need. Once you have enough evidence, synthesize the root cause and choose the safest remediation action.

Available remediation tools:
- "aws_ecs_rollback_service": Use if deployment failed, container crashed on startup, or bad image tag was deployed.
- "aws_ecs_update_service_image": Use if a specific image tag needs updating.
- "aws_ecs_update_service": Use if task counts or service definition need forced update.
- "aws_ecs_describe_services": Use if no failure is detected (informational only).

Once you are done investigating — this must be your FINAL message, after you've finished calling tools — respond with ONLY valid JSON (no markdown, no backticks, no other text) conforming to this schema:
{
  "finding": "<concise 1-2 sentence finding summary>",
  "rootCause": "<detailed technical root cause explanation>",
  "confidence": <number between 0.0 and 1.0>,
  "remediationTool": "<tool name>",
  "remediationParams": { "cluster": "${targetCluster}", "service": "${targetService}", "region": "${targetRegion}" },
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "requiresApproval": <boolean>,
  "investigationNarrative": ["<one short sentence per tool call/step you took and what you learned from it, in order>"]
}`;

    // A real multi-turn tool-calling loop against a live MCP server needs
    // materially more time than the fixed path's single synthesis-only call
    // (30s) — bounded by HermesProfileService's own GOVERNED_MAX_TURNS cap
    // on the profile, not by this timeout, but the timeout still has to be
    // generous enough to let a legitimate multi-tool investigation finish.
    const rawOutput = await this.executeHermesInference(prompt, 120000);
    const parsed = extractJsonFromLlmOutput(rawOutput);

    if (!parsed || !parsed.finding || !parsed.rootCause) {
      throw new Error(
        "Adaptive investigation: Hermes did not return a parseable finding/rootCause JSON response"
      );
    }

    const finding: string = parsed.finding;
    const rootCauseText: string = parsed.rootCause;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.85;
    const remediationToolName: string = parsed.remediationTool || "aws_ecs_describe_services";
    const remediationParams: Record<string, unknown> =
      parsed.remediationParams && typeof parsed.remediationParams === "object"
        ? parsed.remediationParams
        : { cluster: targetCluster, service: targetService, region: targetRegion };
    let riskLevel: string = parsed.riskLevel ? String(parsed.riskLevel).toUpperCase() : "LOW";
    if (
      (remediationToolName.includes("rollback") ||
        remediationToolName.includes("update") ||
        remediationToolName.includes("remediate")) &&
      riskLevel !== "CRITICAL"
    ) {
      riskLevel = "HIGH";
    }

    // ADR-0008 Phase B design notes §4.4(b): Hermes's tool-calling loop talks
    // to CloudOpsMcpServer directly over SSE — this process never sees each
    // individual call the way the fixed-script path's handler() does, so
    // there's no live per-call reasoning to attach the way
    // tool_executions.reasoning_snippet normally captures (confirmed against
    // the installed MCP SDK: neither CallToolRequestParamsSchema nor
    // RequestHandlerExtra carry anything beyond the standard _meta
    // progressToken/related-task keys). Instead, Hermes is asked to narrate
    // its own steps as `investigationNarrative` above, reconstructed here
    // into the same STEP/OBSERVATION event shapes the fixed path emits.
    const narrative: string[] = Array.isArray(parsed.investigationNarrative)
      ? parsed.investigationNarrative.filter((line: unknown): line is string => typeof line === "string" && line.trim().length > 0)
      : [];

    if (narrative.length === 0) {
      // A valid, usable JSON response with nothing to reconstruct a
      // step-by-step trace from isn't a failure — emit one OBSERVATION so
      // the UI still shows the adaptive loop did something, rather than
      // silently emitting zero steps beyond the initial STEP above.
      this.emitEvent(sessionId, {
        type: "OBSERVATION",
        sessionId,
        timestamp: new Date(),
        data: {
          step: 2,
          toolName: "hermes_adaptive_investigation",
          observation: `${effectiveAgentName} completed an adaptive investigation but did not narrate individual steps.`
        }
      });
    } else {
      narrative.forEach((line, idx) => {
        this.emitEvent(sessionId, {
          type: idx === 0 ? "STEP" : "OBSERVATION",
          sessionId,
          timestamp: new Date(),
          data: {
            step: idx + 2,
            toolName: "hermes_adaptive_investigation",
            observation: line,
            ...(idx === 0 ? { status: "running" } : {})
          }
        });
      });
    }

    // Adaptive tool calls happen inside Hermes's own loop against the MCP
    // server directly, so this process never mints its own evidence ids the
    // way the fixed-script path does per step — session.evidenceCollected
    // stays whatever it already was (typically empty for an adaptive run).
    const evidenceCollected = session.evidenceCollected || [];

    const rootCause = {
      finding,
      rootCause: rootCauseText,
      confidence,
      evidenceIds: evidenceCollected,
      citedRunbooks: [],
      affectedResources: [`arn:aws:ecs:${targetRegion}:*:service/${targetCluster}/${targetService}`],
      dataSource: `live:${this.adapterType}:${effectiveModel}:adaptive`,
      recommendedRemediation: {
        toolName: remediationToolName,
        parameters: remediationParams,
        riskLevel,
        requiresApproval: riskLevel === "HIGH" || riskLevel === "CRITICAL"
      }
    };

    this.emitEvent(sessionId, {
      type: "ROOT_CAUSE",
      sessionId,
      timestamp: new Date(),
      data: rootCause
    });

    // Same approval-gating path as the fixed-script path (§4.5 of the Phase
    // B design notes): Phase B changes investigation, not remediation
    // proposal.
    if (riskLevel === "HIGH" || riskLevel === "CRITICAL") {
      this.emitEvent(sessionId, {
        type: "PROPOSAL",
        sessionId,
        timestamp: new Date(),
        data: {
          toolName: remediationToolName,
          remediation: rootCause.recommendedRemediation,
          status: "AWAITING_APPROVAL"
        }
      });

      const proposalCall: AgentToolCall = {
        callId: `call_${randomUUID()}`,
        toolName: remediationToolName,
        arguments: remediationParams,
        timestamp: new Date(),
        reasoning: `${finding} ${rootCauseText}`.trim(),
        evidenceRefs: [...evidenceCollected]
      };

      const proposalResult = await handler(proposalCall);

      if (proposalResult.status === "AWAITING_APPROVAL") {
        session.status = "WAITING_APPROVAL";
        session.pendingApprovalId = proposalResult.approvalId;
      } else {
        session.status = "COMPLETED";
      }
    } else {
      session.status = "COMPLETED";
    }

    session.evidenceCollected = evidenceCollected;

    return {
      status: session.status,
      rootCause,
      approvalId: session.pendingApprovalId || undefined
    };
  }

  /**
   * The pre-Phase-B investigation turn, unchanged: the fixed-script safety
   * net `runInvestigation()` falls back to whenever there's no governed
   * Hermes profile, or the adaptive loop above throws for any reason.
   *
   * Each diagnostic step calls a canonical tool via the registered handler,
   * then derives its observation text DIRECTLY from the real tool result data.
   * No strings are hardcoded — every observation is grounded in live telemetry.
   */
  private async runFixedScriptInvestigation(
    sessionId: string,
    incidentContext?: InvestigationDriveContext
  ): Promise<InvestigationDriveResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    // Prefer registered handler (injected by investigations.ts for approval gating)
    const handler =
      this.toolCallHandlers.get(sessionId) ||
      (async (call: AgentToolCall): Promise<AgentToolResult> => {
        if (
          call.toolName.includes("update") ||
          call.toolName.includes("rollback") ||
          call.toolName.includes("remediate")
        ) {
          return {
            callId: call.callId,
            status: "AWAITING_APPROVAL",
            approvalId: `appr_${randomUUID().substring(0, 8)}`,
            data: { message: "Remediation mutation queued for human operator authorization" }
          };
        }
        return {
          callId: call.callId,
          status: "SUCCESS",
          data: { status: "INSPECTED", timestamp: new Date().toISOString() }
        };
      });

    const targetCluster = incidentContext?.cluster || "cloudops-test";
    const targetService = incidentContext?.service || "starvision-motors";
    const targetRegion = incidentContext?.region || "us-east-1";

    const delay = (ms: number) =>
      process.env.NODE_ENV === "test" ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

    const evidenceCollected: string[] = [];

    // ── Step 1: aws_ecs_describe_services ──────────────────────────────────────
    session.currentStep = 1;
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: 1, toolName: "aws_ecs_describe_services", status: "running" }
    });

    await delay(700);

    const step1Result = await handler({
      callId: `call_${randomUUID()}`,
      toolName: "aws_ecs_describe_services",
      arguments: { cluster: targetCluster, services: [targetService], region: targetRegion },
      timestamp: new Date(),
      reasoning: "Establishing baseline service health (desired/running/pending task counts) before diagnosing the reported alert.",
      evidenceRefs: []
    });

    // Build observation from real data
    const svcData = (step1Result.data as any);
    const svc = svcData?.services?.[0];
    const step1Observation = svc
      ? `Service '${svc.serviceName || targetService}' — desiredCount=${svc.desiredCount}, runningCount=${svc.runningCount}, pendingCount=${svc.pendingCount}. ` +
        (svc.deployments?.[0]
          ? `Active deployment: ${svc.deployments[0].status} (rollout: ${svc.deployments[0].rolloutState || "IN_PROGRESS"}, failedTasks: ${svc.deployments[0].failedTasks ?? 0}).`
          : `Deployment state unavailable.`) +
        (svcData?.error ? ` [AWS error: ${svcData.error}]` : "")
      : svcData?.error
      ? `aws_ecs_describe_services returned error: ${svcData.error} (${svcData.code || "UNKNOWN"}). Service may not exist in cluster '${targetCluster}'.`
      : `No service data returned for '${targetService}' in cluster '${targetCluster}'. Verify the cluster and service names.`;

    this.emitEvent(sessionId, {
      type: "OBSERVATION",
      sessionId,
      timestamp: new Date(),
      data: {
        step: 1,
        toolName: "aws_ecs_describe_services",
        observation: step1Observation,
        result: step1Result.data
      }
    });

    await delay(800);

    // ── Step 2: aws_cloudwatch_get_metric_data (5xx anomaly detection) ─────────
    session.currentStep = 2;
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: 2, toolName: "aws_cloudwatch_get_metric_data", status: "running" }
    });

    await delay(800);

    const step2Result = await handler({
      callId: `call_${randomUUID()}`,
      toolName: "aws_cloudwatch_get_metric_data",
      arguments: {
        metricName: "HTTPCode_Target_5XX_Count",
        namespace: "AWS/ApplicationELB",
        region: targetRegion,
        cluster: targetCluster,
        service: targetService
      },
      timestamp: new Date(),
      reasoning: "Checking for a correlated metric anomaly (e.g. 5xx spike) that would corroborate or narrow down the service-health signal from the previous step.",
      evidenceRefs: [...evidenceCollected]
    });

    const metricData = (step2Result.data as any);
    const alarmState = metricData?.alarmState || metricData?.serviceHealth?.rolloutState || "UNKNOWN";
    const is5xxAlarm = alarmState === "ALARM" || alarmState === "FAILED";
    const metricEvidenceId = `ev_5xx_${randomUUID().substring(0, 8)}`;
    evidenceCollected.push(metricEvidenceId);

    const step2Observation = metricData?.error
      ? `CloudWatch query error: ${metricData.error}`
      : metricData?.serviceHealth
      ? `ECS-derived health signal (CloudWatch SDK not installed): ` +
        `desired=${metricData.serviceHealth.desiredCount}, running=${metricData.serviceHealth.runningCount}, ` +
        `failedTasks=${metricData.serviceHealth.failedTasks}, rolloutState=${metricData.serviceHealth.rolloutState}. ` +
        `Alarm state: ${alarmState}.`
      : `Metric '${metricData?.metric}' in '${metricData?.namespace}' — state: ${alarmState}.`;

    this.emitEvent(sessionId, {
      type: "EVIDENCE",
      sessionId,
      timestamp: new Date(),
      data: {
        evidenceId: metricEvidenceId,
        source: "AWS/CloudWatch",
        resource: `${targetCluster}/${targetService}`,
        observation: step2Observation,
        severity: is5xxAlarm ? "CRITICAL" : "INFORMATIONAL",
        result: step2Result.data
      }
    });

    await delay(800);

    // ── Step 3: aws_ecs_describe_stopped_tasks ─────────────────────────────────
    session.currentStep = 3;
    this.emitEvent(sessionId, {
      type: "STEP",
      sessionId,
      timestamp: new Date(),
      data: { step: 3, toolName: "aws_ecs_describe_stopped_tasks", status: "running" }
    });

    await delay(800);

    const step3Result = await handler({
      callId: `call_${randomUUID()}`,
      toolName: "aws_ecs_describe_stopped_tasks",
      arguments: { cluster: targetCluster, service: targetService, region: targetRegion },
      timestamp: new Date(),
      reasoning: "Inspecting recently stopped tasks for a concrete container-level failure signal (e.g. exit reason), since service status and metrics alone don't explain a root cause.",
      evidenceRefs: [...evidenceCollected]
    });

    const stoppedData = (step3Result.data as any);
    const containerEvidenceId = `ev_stop_${randomUUID().substring(0, 8)}`;
    evidenceCollected.push(containerEvidenceId);

    const stopReason =
      stoppedData?.stopReasonSummary ||
      stoppedData?.stoppedTasks?.[0]?.stoppedReason ||
      stoppedData?.tasks?.[0]?.stoppedReason;
    const containerError =
      stoppedData?.containerErrorSummary ||
      stoppedData?.stoppedTasks?.[0]?.containers?.[0]?.reason ||
      stoppedData?.tasks?.[0]?.containers?.[0]?.reason;
    const stoppedTaskCount =
      stoppedData?.stoppedTaskCount ??
      stoppedData?.tasks?.length ??
      stoppedData?.stoppedTasks?.length ??
      0;
    const step3Observation = stoppedData?.error
      ? `Stopped task query error: ${stoppedData.error} (${stoppedData.code || "UNKNOWN"})`
      : stoppedTaskCount === 0
      ? `No stopped tasks found for '${targetService}'. Service may be healthy or not yet scheduled.`
      : `Found ${stoppedTaskCount} stopped task(s) for '${targetService}'.` +
        (stopReason ? ` Stop reason: "${stopReason}".` : "") +
        (containerError ? ` Container exit error: "${containerError}".` : "");

    this.emitEvent(sessionId, {
      type: "EVIDENCE",
      sessionId,
      timestamp: new Date(),
      data: {
        evidenceId: containerEvidenceId,
        source: "AWS/ECS",
        resource: `${targetCluster}/${targetService}`,
        observation: step3Observation,
        severity: stoppedTaskCount > 0 ? "CRITICAL" : "LOW",
        result: step3Result.data
      }
    });

    await delay(900);

    // ── Retrieval (Phase 2.9): ground the synthesis step in any relevant
    // runbook/past-incident-resolution content for this tenant. Fails soft —
    // an empty/missing knowledge base must never block the investigation.
    let retrievedChunks: Array<{ sourceId: string; content: string; distance: number; metadata: Record<string, unknown> }> = [];
    try {
      const { searchKnowledge } = await import("@cloudops/embeddings");
      const retrievalQuery = `${incidentContext?.alertDescription || ""} ${step3Observation}`.trim();
      retrievedChunks = await searchKnowledge(session.tenantId, retrievalQuery, 2);
    } catch (err) {
      logger.debug({ err }, "Runbook retrieval skipped (no knowledge base reachable for this tenant)");
    }
    // A generous relevance ceiling (cosine distance range is [0,2] for
    // normalized vectors) — filters out results retrieved only because they
    // were the least-bad match in a mostly-unrelated knowledge base.
    const citedRunbooks = retrievedChunks
      .filter((c) => c.distance < 1.2)
      .map((c) => ({
        title: (c.metadata as any)?.runbookTitle || c.sourceId,
        sourceId: c.sourceId,
        distance: c.distance,
        excerpt: c.content
      }));

    if (citedRunbooks.length > 0) {
      this.emitEvent(sessionId, {
        type: "OBSERVATION",
        sessionId,
        timestamp: new Date(),
        data: {
          step: 4,
          toolName: "runbook_retrieval",
          observation: `Retrieved ${citedRunbooks.length} relevant runbook excerpt(s): ${citedRunbooks.map((r) => r.title).join(", ")}`
        }
      });
    }

    // ── Step 4: Root Cause Synthesis (Grounded in real telemetry & live LLM reasoning) ───
    let finding = "";
    let rootCauseText = "";
    let confidence = 0.85;
    let remediationToolName = "aws_ecs_rollback_service";
    let remediationParams: Record<string, unknown> = {
      cluster: targetCluster,
      service: targetService,
      region: targetRegion
    };
    let riskLevel = "HIGH";
    let dataSource = "live:aws:ecs";
    let hermesInferenceSucceeded = false;

    if (this.enableLiveInference || incidentContext?.liveInference) {
      try {
        if (!this.activeModel) {
          await this.checkHermesHealth();
        }
        const effectiveModel = this.activeModel || "agent-runtime";
        const effectiveAgentName = this.agentName || "CloudOps Autonomous SRE Agent";

        const runbookSection =
          citedRunbooks.length > 0
            ? `\nRelevant Runbook Excerpts (cite by title in your rootCause if you rely on one):\n` +
              citedRunbooks.map((r) => `--- "${r.title}" ---\n${r.excerpt}`).join("\n\n") +
              "\n"
            : "";

        const inferencePrompt = `You are ${effectiveAgentName} (${effectiveModel}).
Analyze the following telemetry collected for service "${targetService}" in cluster "${targetCluster}" (${targetRegion}):
Alert: ${incidentContext?.alertDescription || "ECS service health anomaly"}

Telemetry Data:
- Service Status: ${step1Observation}
- CloudWatch Target Group Metrics: ${step2Observation}
- Stopped Tasks & Container Exit Diagnostics: ${step3Observation}
${runbookSection}
Based on these observations${citedRunbooks.length > 0 ? " and any relevant runbook excerpts above" : ""}, synthesize the root cause and choose the safest remediation action.
Available remediation tools:
- "aws_ecs_rollback_service": Use if deployment failed, container crashed on startup, or bad image tag was deployed.
- "aws_ecs_update_service_image": Use if specific image tag needs updating.
- "aws_ecs_update_service": Use if task counts or service definition need forced update.
- "aws_ecs_describe_services": Use if no failure detected (informational only).

Respond strictly with valid JSON conforming to this schema (no markdown, no backticks):
{
  "finding": "<concise 1-2 sentence finding summary>",
  "rootCause": "<detailed technical root cause explanation. If a runbook excerpt informed this, name it explicitly, e.g. 'Per runbook \\"X\\", ...'>",
  "confidence": <number between 0.0 and 1.0>,
  "remediationTool": "<tool name>",
  "remediationParams": { "cluster": "${targetCluster}", "service": "${targetService}", "region": "${targetRegion}" },
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "requiresApproval": <boolean>
}`;

        const rawOutput = await this.executeHermesInference(inferencePrompt, 30000);
        const parsed = extractJsonFromLlmOutput(rawOutput);
        if (parsed && parsed.finding && parsed.rootCause) {
          finding = parsed.finding;
          rootCauseText = parsed.rootCause;
          confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.92;
          if (parsed.remediationTool) {
            remediationToolName = parsed.remediationTool;
          }
          if (parsed.remediationParams && typeof parsed.remediationParams === "object") {
            remediationParams = parsed.remediationParams;
          }
          if (parsed.riskLevel) {
            riskLevel = String(parsed.riskLevel).toUpperCase();
          }
          // Any rollback or update tool is inherently a mutating cloud action
          if (
            remediationToolName.includes("rollback") ||
            remediationToolName.includes("update") ||
            remediationToolName.includes("remediate")
          ) {
            if (riskLevel !== "CRITICAL") {
              riskLevel = "HIGH";
            }
          }
          dataSource = `live:${this.adapterType}:${effectiveModel}`;
          hermesInferenceSucceeded = true;

          this.emitEvent(sessionId, {
            type: "OBSERVATION",
            sessionId,
            timestamp: new Date(),
            data: {
              step: 4,
              toolName: `${this.adapterType}_neural_reasoning`,
              observation: `${effectiveAgentName} synthesized root cause: ${finding}`,
              model: effectiveModel
            }
          });
        }
      } catch (err) {
        logger.warn({ err }, "Live Hermes inference failed, falling back to grounded telemetry heuristics");
      }
    }

    if (!hermesInferenceSucceeded) {
      // Grounded truthful telemetry evaluation directly from live AWS SDK inspection
      const hasStoppedTasks = stoppedTaskCount > 0;
      const deploymentFailed =
        svc?.deployments?.[0]?.rolloutState === "FAILED" ||
        (svc?.deployments?.[0]?.failedTasks ?? 0) > 0;
      const awsError = svcData?.error || stoppedData?.error;

      if (awsError && awsError.includes("credentials")) {
        finding = `AWS authentication failure for ${targetService}`;
        rootCauseText = `CloudOps cannot query AWS for cluster '${targetCluster}' — credential or permission error: "${awsError}". ` +
          `Ensure the connected AWS account has ecs:DescribeServices, ecs:ListTasks, and ecs:DescribeTasks permissions.`;
        confidence = 0.99;
        remediationToolName = "aws_ecs_describe_services";
        remediationParams = { cluster: targetCluster, services: [targetService], region: targetRegion };
        riskLevel = "LOW";
      } else if (awsError && (awsError.includes("ClusterNotFoundException") || awsError.includes("ServiceNotFoundException"))) {
        finding = `ECS cluster or service not found: '${targetCluster}/${targetService}'`;
        rootCauseText = `AWS returned a not-found error: "${awsError}". The cluster '${targetCluster}' or service '${targetService}' does not exist in region '${targetRegion}'. ` +
          `Verify the resource names and confirm the correct AWS region is selected.`;
        confidence = 0.99;
        remediationToolName = "aws_ecs_describe_clusters";
        remediationParams = { region: targetRegion };
        riskLevel = "LOW";
      } else if (hasStoppedTasks) {
        const errorDetail = containerError || stopReason || "essential container exited";
        finding = `ECS Tasks stopped for '${targetService}': "${errorDetail}"`;
        rootCauseText = `AWS ECS reports ${stoppedTaskCount} stopped task(s) on cluster '${targetCluster}'. ` +
          (stopReason ? `Task stop reason: "${stopReason}". ` : "") +
          (containerError ? `Container-level error: "${containerError}". ` : "") +
          (errorDetail.toLowerCase().includes("pull") || errorDetail.toLowerCase().includes("image")
            ? `Image pull failure detected — the container image reference may be invalid or the tag may not exist in ECR.`
            : errorDetail.toLowerCase().includes("oom") || errorDetail.toLowerCase().includes("memory")
            ? `Out-of-memory condition — container is exceeding its allocated memory limit.`
            : `Review container logs and task definition for misconfiguration.`);
        confidence = 0.95;
        remediationToolName = "aws_ecs_rollback_service";
        remediationParams = { cluster: targetCluster, service: targetService, region: targetRegion };
        riskLevel = "HIGH";
      } else if (deploymentFailed) {
        finding = `ECS deployment for '${targetService}' is in FAILED state`;
        rootCauseText = `The active ECS deployment on cluster '${targetCluster}' has rolloutState=FAILED with ` +
          `${svc.deployments[0].failedTasks} failed task(s). ` +
          `ECS steady-state check failed — desired=${svc.desiredCount}, running=${svc.runningCount}. ` +
          `This indicates task placement or container startup failures.`;
        confidence = 0.92;
        remediationToolName = "aws_ecs_rollback_service";
        remediationParams = { cluster: targetCluster, service: targetService, region: targetRegion };
        riskLevel = "HIGH";
      } else if (svc && (svc.runningCount ?? 0) < (svc.desiredCount ?? 0)) {
        const missing = (svc.desiredCount ?? 0) - (svc.runningCount ?? 0);
        finding = `ECS service '${targetService}' is under-provisioned: ${missing} task(s) missing`;
        rootCauseText = `Service '${targetService}' on cluster '${targetCluster}' has desiredCount=${svc.desiredCount} but only runningCount=${svc.runningCount}. ` +
          `${missing} task(s) are failing to reach RUNNING state. No stopped tasks found — tasks may be stuck in PENDING state.`;
        confidence = 0.88;
        remediationToolName = "aws_ecs_update_service";
        remediationParams = { cluster: targetCluster, service: targetService, forceNewDeployment: true, region: targetRegion };
        riskLevel = "HIGH";
      } else if (awsError) {
        finding = `AWS API error investigating '${targetService}': ${awsError}`;
        rootCauseText = `Live AWS inspection returned an error: "${awsError}" (code: ${svcData?.code || stoppedData?.code || "UNKNOWN"}). ` +
          `This may indicate permission boundaries, throttling, or regional API issues.`;
        confidence = 0.75;
        remediationToolName = "aws_ecs_describe_services";
        remediationParams = { cluster: targetCluster, services: [targetService], region: targetRegion };
        riskLevel = "LOW";
      } else if (svc) {
        finding = `ECS service '${targetService}' is healthy (desired=${svc.desiredCount}, running=${svc.runningCount})`;
        rootCauseText = `ECS service '${targetService}' on '${targetCluster}' reports desiredCount=${svc.desiredCount}, runningCount=${svc.runningCount}. ` +
          `No stopped tasks or failed deployments were found in the AWS inspection window.`;
        confidence = 0.90;
        remediationToolName = "aws_ecs_describe_services";
        remediationParams = { cluster: targetCluster, services: [targetService], region: targetRegion };
        riskLevel = "LOW";
      } else {
        finding = `No ECS service records returned for '${targetService}' in cluster '${targetCluster}'`;
        rootCauseText = `Live AWS inspection returned no active service data for '${targetService}'. ` +
          `The service may not exist in cluster '${targetCluster}' in region '${targetRegion}', or credentials may lack sufficient permissions.`;
        confidence = 0.7;
        remediationToolName = "aws_ecs_describe_services";
        remediationParams = { cluster: targetCluster, services: [targetService], region: targetRegion };
        riskLevel = "LOW";
      }

      // Grounded fallback path has no LLM to cite the runbook on its own —
      // append the citation directly so retrieval still informs the output
      // whenever live inference is unavailable (e.g. no Hermes daemon).
      if (citedRunbooks.length > 0) {
        const top = citedRunbooks[0]!;
        rootCauseText += ` Per runbook "${top.title}": ${top.excerpt}`;
      }
    }

    const rootCause = {
      finding,
      rootCause: rootCauseText,
      confidence,
      evidenceIds: evidenceCollected,
      citedRunbooks: citedRunbooks.map((r) => ({ title: r.title, sourceId: r.sourceId, distance: r.distance })),
      affectedResources: svc?.serviceArn
        ? [svc.serviceArn]
        : [`arn:aws:ecs:${targetRegion}:*:service/${targetCluster}/${targetService}`],
      dataSource,
      recommendedRemediation: {
        toolName: remediationToolName,
        parameters: remediationParams,
        riskLevel,
        requiresApproval: riskLevel === "HIGH" || riskLevel === "CRITICAL"
      }
    };

    this.emitEvent(sessionId, {
      type: "ROOT_CAUSE",
      sessionId,
      timestamp: new Date(),
      data: rootCause
    });

    await delay(700);

    // ── Step 5: Propose Remediation (only for HIGH/CRITICAL risk) ──────────────
    if (riskLevel === "HIGH" || riskLevel === "CRITICAL") {
      session.currentStep = 4;
      this.emitEvent(sessionId, {
        type: "PROPOSAL",
        sessionId,
        timestamp: new Date(),
        data: {
          toolName: remediationToolName,
          remediation: rootCause.recommendedRemediation,
          status: "AWAITING_APPROVAL"
        }
      });

      const proposalCall: AgentToolCall = {
        callId: `call_${randomUUID()}`,
        toolName: remediationToolName,
        arguments: remediationParams,
        timestamp: new Date(),
        // The actual justification for this mutation — the synthesized
        // finding and root cause, not a generic "proposing remediation"
        // placeholder. This is the single most important reasoning_snippet
        // in the whole investigation: it's what a human approver reads.
        reasoning: `${finding} ${rootCauseText}`.trim(),
        evidenceRefs: [...evidenceCollected]
      };

      const proposalResult = await handler(proposalCall);

      if (proposalResult.status === "AWAITING_APPROVAL") {
        session.status = "WAITING_APPROVAL";
        session.pendingApprovalId = proposalResult.approvalId;
      } else {
        session.status = "COMPLETED";
      }
    } else {
      session.status = "COMPLETED";
    }

    session.evidenceCollected = evidenceCollected;

    return {
      status: session.status,
      rootCause,
      approvalId: session.pendingApprovalId || undefined
    };
  }

  private emitEvent(sessionId: string, event: AgentEvent): void {
    const listeners = this.eventListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          logger.error({ err, sessionId, eventType: event.type }, "Error in Hermes event listener");
        }
      }
    }
  }
}
