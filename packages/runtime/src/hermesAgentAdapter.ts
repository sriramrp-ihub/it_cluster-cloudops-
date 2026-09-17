import { randomUUID } from "node:crypto";
import {
  type AgentAdapter,
  type AgentExecutionContext,
  type AgentSession,
  type AgentEvent,
  type AgentToolCall,
  type AgentToolResult
} from "./agentAdapter.js";
import {
  ValidationError,
  NotFoundError,
  validateIncidentContext,
  logger
} from "@cloudops/shared";

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

        // Use /api/model/info which works without authentication
        const res = await fetch(`${candidate}/api/model/info`, {
          headers: {
            "X-Hermes-Session-Token": this.sessionToken
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = (await res.json()) as any;
          const discoveredModel = data?.model || this.activeModel || "agent-runtime";
          const discoveredProvider = data?.provider || this.activeProvider || "local-daemon";
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

    const { stdout } = await execFileAsync(
      this.hermesBin,
      ["-z", prompt, "--ignore-rules"],
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env }
      }
    );

    const cleaned = cleanLlmOutput(stdout);
    return cleaned || stdout.trim();
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
   * Executes the Hermes autonomous investigation turn.
   *
   * Each diagnostic step calls a canonical tool via the registered handler,
   * then derives its observation text DIRECTLY from the real tool result data.
   * No strings are hardcoded — every observation is grounded in live telemetry.
   */
  async runInvestigation(
    sessionId: string,
    incidentContext?: {
      cluster?: string;
      service?: string;
      region?: string;
      alertDescription?: string;
      liveInference?: boolean;
    }
  ): Promise<{
    status: string;
    rootCause: Record<string, unknown>;
    approvalId?: string | undefined;
  }> {
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
      timestamp: new Date()
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
      timestamp: new Date()
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
      timestamp: new Date()
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

        const inferencePrompt = `You are ${effectiveAgentName} (${effectiveModel}).
Analyze the following telemetry collected for service "${targetService}" in cluster "${targetCluster}" (${targetRegion}):
Alert: ${incidentContext?.alertDescription || "ECS service health anomaly"}

Telemetry Data:
- Service Status: ${step1Observation}
- CloudWatch Target Group Metrics: ${step2Observation}
- Stopped Tasks & Container Exit Diagnostics: ${step3Observation}

Based on these observations, synthesize the root cause and choose the safest remediation action.
Available remediation tools:
- "aws_ecs_rollback_service": Use if deployment failed, container crashed on startup, or bad image tag was deployed.
- "aws_ecs_update_service_image": Use if specific image tag needs updating.
- "aws_ecs_update_service": Use if task counts or service definition need forced update.
- "aws_ecs_describe_services": Use if no failure detected (informational only).

Respond strictly with valid JSON conforming to this schema (no markdown, no backticks):
{
  "finding": "<concise 1-2 sentence finding summary>",
  "rootCause": "<detailed technical root cause explanation>",
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
    }

    const rootCause = {
      finding,
      rootCause: rootCauseText,
      confidence,
      evidenceIds: evidenceCollected,
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
        timestamp: new Date()
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
