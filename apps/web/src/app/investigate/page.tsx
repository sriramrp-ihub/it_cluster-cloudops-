"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";
import { useOperator } from "../../auth/OperatorContext";
import { fetchSwarmTrace, SwarmTraceResponse } from "../../lib/api";
import {
  SwarmTopologyView,
  SwarmTopologyData,
  SwarmWorkerNode,
  SwarmRoleNode,
  SwarmNodeStatus
} from "../../components/investigate/SwarmTopologyView";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

interface Incident {
  id: string;
  provider: string;
  accountId: string;
  region: string;
  service: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "OPEN" | "INVESTIGATING" | "IDENTIFIED" | "REMEDIATING" | "RESOLVED";
  title: string;
  alertDescription: string;
  createdAt: string;
  investigationStatus?: string;
}

interface LiveStep {
  step: number;
  toolName: string;
  status: "pending" | "running" | "completed";
  observation?: string;
  evidenceId?: string;
  /**
   * Live-only: the most recently-observed tool call this step's own
   * in-flight Hermes oneshot call has made, from a "PROGRESS" SSE event (see
   * packages/runtime/src/swarmProgressPoller.ts). Only ever rendered while
   * `status === "running"` — once the step completes, the real `observation`
   * takes over, so this never needs to be explicitly cleared.
   */
  progressLine?: string;
}

interface OnboardedAgent {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  version: string;
  runtimeProtocol: string;
  status: string;
}

interface RootCause {
  finding: string;
  rootCause: string;
  confidence: number;
  evidenceIds: string[];
  affectedResources: string[];
  /**
   * Real signal from packages/runtime/src/hermesAgentAdapter.ts's swarm
   * verifier stage, reused verbatim (never re-derived client-side) — only
   * the swarm tier ever runs an independent verifier, so "verified"/
   * "flagged" only ever come from it. The adaptive and fixed-script tiers
   * have no separate verification stage at all and always report
   * "unverified", honestly — optional because historical investigations
   * recorded before this field existed won't have it (see
   * deriveConfidenceLabelFallback below for that case).
   */
  verificationStatus?: "verified" | "flagged" | "unverified";
  /**
   * The verifier's own real flagged contradictions (e.g. "Worker 1 reports
   * 2/2 tasks, Worker 3 reports 1/1") — empty array when the verifier found
   * nothing to flag, populated only for the swarm tier's "flagged" gate.
   */
  flaggedInconsistencies?: string[];
  /**
   * [PROPOSED] Graded confidence label computed server-side by
   * deriveConfidenceLabel() in hermesAgentAdapter.ts — see that function's
   * doc comment for the exact thresholds and reasoning. Optional for the
   * same historical-record reason as verificationStatus above.
   */
  confidenceLabel?: string;
  recommendedRemediation?: {
    toolName: string;
    riskLevel: string;
    requiresApproval: boolean;
    // Bug fix: whether there is an actual action to take at all, set
    // authoritatively server-side (packages/runtime/src/hermesAgentAdapter.ts's
    // isMutatingRemediationTool) rather than inferred from riskLevel alone.
    // Optional because historical investigations persisted before this field
    // existed won't have it — isMutatingToolName() below is the same
    // fallback classifier for that case.
    actionNeeded?: boolean;
    parameters?: Record<string, unknown>;
  };
}

/**
 * Client-side fallback for `recommendedRemediation.actionNeeded` on
 * historical investigations recorded before that field existed. Mirrors
 * packages/runtime/src/hermesAgentAdapter.ts's isMutatingRemediationTool —
 * every read-only/informational tool this product's investigation prompts
 * ever offer (e.g. "aws_ecs_describe_services: Use if no failure is
 * detected") names itself describe/list/get; every real mutation
 * (rollback/update) doesn't.
 */
function isMutatingToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  if (name.includes("describe") || name.includes("list") || name.includes("get_")) {
    return false;
  }
  return true;
}

/**
 * Client-side fallback mirroring packages/runtime/src/hermesAgentAdapter.ts's
 * deriveConfidenceLabel() exactly (same thresholds, same reasoning — see
 * that function's doc comment), used only for historical investigations
 * persisted before `confidenceLabel`/`verificationStatus` existed. Any
 * investigation completed after this change already carries a real
 * server-computed `confidenceLabel`, so this never runs for those.
 */
function deriveConfidenceLabelFallback(
  confidence: number,
  verificationStatus: "verified" | "flagged" | "unverified" | undefined,
  flaggedInconsistencies: string[]
): string {
  const LOW_CONFIDENCE = 0.5;
  const HIGH_CONFIDENCE = 0.85;
  const status = verificationStatus ?? "unverified";

  if (confidence < LOW_CONFIDENCE) {
    return "Inconclusive — confidence too low to act on";
  }
  if (status === "flagged") {
    if (flaggedInconsistencies.length >= 2) {
      return `Inconclusive — ${flaggedInconsistencies.length} independent inconsistencies flagged`;
    }
    return "Supported by evidence — one inconsistency noted";
  }
  if (status === "verified") {
    return confidence >= HIGH_CONFIDENCE ? "Validated — no contradictions found" : "Validated — supported by verified evidence";
  }
  return "Single-agent assessment — not independently verified";
}

/**
 * Badge palette for the graded confidence label — reuses this app's own
 * existing status-color conventions verbatim (apps/web/src/app/approvals
 * /page.tsx's STATUS_COLORS: green=EXECUTED-like/good, amber=PENDING/needs
 * attention, gray=EXPIRED/neutral-unknown, red=REJECTED-FAILED-like/serious
 * doubt) rather than inventing a new palette.
 */
const VERIFICATION_BADGE_COLORS: Record<"verified" | "flagged" | "unverified" | "inconclusive", { bg: string; border: string; color: string }> = {
  verified: { bg: "#ecfdf5", border: "#bbf7d0", color: "#16a34a" },
  flagged: { bg: "#fffbeb", border: "#fde68a", color: "#b45309" },
  unverified: { bg: "#f3f4f6", border: "#d1d5db", color: "#6b7280" },
  inconclusive: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" }
};

function confidenceBadgeKey(
  label: string,
  verificationStatus: "verified" | "flagged" | "unverified" | undefined
): "verified" | "flagged" | "unverified" | "inconclusive" {
  if (label.startsWith("Inconclusive")) return "inconclusive";
  return verificationStatus ?? "unverified";
}

const SWARM_STATUS_MAP: Record<string, SwarmNodeStatus> = {
  COMPLETED: "completed",
  FAILED: "failed",
  RUNNING: "running"
};

/**
 * Maps the historical `GET /v1/investigations/:id/swarm-trace` response into
 * the same SwarmTopologyData shape the live SSE path builds, so
 * SwarmTopologyView never needs to know which mode produced its data. Each
 * child run's `finalResponse` is that stage's own raw JSON string (parsed
 * per-role — workers/verifier/synthesizer each use a genuinely different
 * schema, see hermesAgentAdapter.ts's runSwarmInvestigation()); a parse
 * failure just means that node's `finding` stays empty, not a hard error.
 *
 * Bug fix (state desync found live: a run with 1 FAILED worker + 2
 * COMPLETED showed a fully-synthesized 95%-confidence Root Cause panel
 * while the topology's verifier/synthesizer sat stuck on PENDING with no
 * explanation). Root cause traced precisely: this function used to
 * hardcode `fellBack: false` unconditionally, on the theory that "a
 * persisted swarm-trace row only exists when the swarm produced at least
 * one child run, so a fall-back-before-any-child-run case has nothing to
 * render historically" — true as far as it goes, but it ignored the OTHER
 * real case: the swarm genuinely dispatched worker(s), one or more failed,
 * `Promise.all` rejected (packages/runtime/src/hermesAgentAdapter.ts's
 * `runSwarmInvestigation` re-throws per-worker before the verifier/
 * synthesizer stages ever run), and `runInvestigation()` correctly fell
 * through to the adaptive/fixed-script tier for the actual result. In that
 * case verifier/synthesizer showing "never ran" IS correct — but with
 * `fellBack` wrongly hardcoded false, the "swarm attempt did not
 * complete" banner (rendered by SwarmTopologyView whenever
 * `data.fellBack` is true) never appeared, silently masking why. Worse,
 * this stale-`false` version doesn't just apply to page reloads: the
 * page's own historical-refetch effect (below, keyed off `isInvestigating`)
 * re-fires the instant the `root_cause` SSE event flips `isInvestigating`
 * to false — i.e. immediately after the LIVE stream had already set
 * `fellBack: true` correctly — clobbering the correct live state with
 * this incorrect historical one within the same completion. Fixed by
 * deriving `fellBack` from what the persisted children actually show:
 * investigator workers exist (the swarm demonstrably got underway) but no
 * synthesizer child was ever created (its stage never ran) — the same
 * signal a human reading the raw trace rows would use.
 */
function mapSwarmTraceToTopology(trace: Extract<SwarmTraceResponse, { isSwarm: true }>): SwarmTopologyData {
  const workers: SwarmWorkerNode[] = [];
  let verifier: SwarmRoleNode | null = null;
  let synthesizer: SwarmRoleNode | null = null;

  for (const child of trace.children) {
    let parsed: any = null;
    if (child.finalResponse) {
      try {
        parsed = JSON.parse(child.finalResponse);
      } catch {
        parsed = null;
      }
    }
    const status: SwarmNodeStatus = SWARM_STATUS_MAP[child.status] || "pending";

    if (child.role === "investigator") {
      const toolName = child.toolExecutions[0]?.toolName || "investigator";
      workers.push({
        key: child.runId,
        toolName,
        agentId: child.agentId,
        agentName: child.agentName,
        status,
        finding: parsed?.domainFinding ?? null,
        evidence: typeof parsed?.evidence === "string" ? parsed.evidence : null
      });
    } else if (child.role === "verifier") {
      verifier = {
        agentId: child.agentId,
        agentName: child.agentName,
        status,
        finding: parsed
          ? `Verified ${parsed.verifiedFindings?.length ?? 0} finding(s); confidence=${parsed.overallConfidence}` +
            (parsed.flaggedInconsistencies?.length ? `; ${parsed.flaggedInconsistencies.length} inconsistency(ies) flagged` : "")
          : null
      };
    } else if (child.role === "synthesizer") {
      synthesizer = {
        agentId: child.agentId,
        agentName: child.agentName,
        status,
        finding: parsed?.finding ?? null
      };
    }
  }

  // A synthesizer child only ever gets created once every worker AND the
  // verifier stage succeeded (see runSwarmInvestigation's stage order) — so
  // "workers exist but no synthesizer child does" unambiguously means the
  // swarm attempt was abandoned partway through, exactly like the live
  // `routeSwarmStep` fallback detection does for an in-progress stream.
  const fellBack = workers.length > 0 && synthesizer === null;

  return { workers, verifier, synthesizer, fellBack };
}

export default function InvestigatePage() {
  const { setChatContext, openChat } = useAgentChat();
  const { session } = useOperator();
  const tenantId = session?.tenantId;
  const operatorId = session?.operatorId;
  const hasAutoPopulated = useRef(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [rootCause, setRootCause] = useState<RootCause | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [highlightedEvidenceId, setHighlightedEvidenceId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // ADR-0007 Phase C1b: non-null only for a swarm-mode investigation (live or
  // historical) — null means "ordinary investigation", which keeps rendering
  // the flat liveSteps list exactly as before this feature existed.
  const [swarmData, setSwarmData] = useState<SwarmTopologyData | null>(null);
  // Synchronous companion to swarmData's async state updates: read inside SSE
  // handlers to decide whether an incoming event is swarm-shaped, without
  // waiting on a render cycle. Reset alongside swarmData on every new trigger.
  const swarmActiveRef = useRef(false);

  // Dynamic investigation configuration parameters
  const [targetService, setTargetService] = useState("starvision-motors");
  const [targetCluster, setTargetCluster] = useState("cloudops-test");
  const [targetRegion, setTargetRegion] = useState("us-east-1");
  const [targetSeverity, setTargetSeverity] = useState<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW">("CRITICAL");
  const [targetAlertDesc, setTargetAlertDesc] = useState(
    "Service health anomaly on ECS tasks. Tasks failing steady-state verification. ALB target 5xx error rate spiking."
  );
  const [discoveredWorkloads, setDiscoveredWorkloads] = useState<{ name: string; cluster?: string; region?: string }[]>([]);
  const [availableAgents, setAvailableAgents] = useState<OnboardedAgent[]>([]);

  // Conversational target resolution — replaces the manual
  // cluster/service/region form. The operator just describes what's wrong;
  // if it's ambiguous, the agent asks a real clarifying question (grounded
  // in the tenant's actual discovered ECS services) instead of guessing.
  const [chatTurns, setChatTurns] = useState<{ role: "operator" | "agent"; text: string }[]>([
    { role: "agent", text: "What's going on? Describe the symptom, and which service it's affecting if you know it." }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [resolvingTarget, setResolvingTarget] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  // 1. Fetch real incidents, connected workloads, and onboarded agents from PostgreSQL API
  const loadIncidents = useCallback(async () => {
    if (!tenantId || !operatorId) return;
    try {
      setLoading(true);
      const headers = { "x-tenant-id": tenantId, "x-operator-id": operatorId };

      const res = await fetch(`${API_BASE}/v1/incidents`, { headers });
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        setIncidents(items);
        // Only ever auto-surface a genuinely active incident — silently
        // defaulting to the most recent one regardless of status meant a
        // long-resolved test incident's stale root-cause panel would show
        // up on page load, unconnected to whatever the operator is
        // currently describing in the chat above it. A past (resolved)
        // incident is still reachable by deliberately clicking its row.
        const activeIncident = items.find((i: Incident) => i.status !== "RESOLVED");
        if (activeIncident && !selectedIncidentId) {
          setSelectedIncidentId(activeIncident.id);
        }
      }

      // Query connected cloud accounts and workloads dynamically. Only ever
      // overwrite the operator's target-config fields once, on first real
      // load — otherwise every re-fetch (triggered by this same callback's
      // own state changes below) would stomp whatever the operator had
      // since typed into those fields.
      try {
        const accRes = await fetch(`${API_BASE}/v1/cloud-accounts`, { headers });
        if (accRes.ok) {
          const accsBody = await accRes.json();
          const accs = Array.isArray(accsBody) ? accsBody : accsBody.items || [];
          const connectedAccount = accs.find((a: any) => a.status === "CONNECTED") || accs[0];
          if (connectedAccount?.region) {
            const wlRes = await fetch(`${API_BASE}/v1/cloud-accounts/${connectedAccount.id}/workloads`, { headers });
            if (wlRes.ok) {
              const wlData = await wlRes.json();
              if (Array.isArray(wlData?.workloads) && wlData.workloads.length > 0) {
                // This whole investigation pipeline is ECS-specific (it calls
                // DescribeServices/DescribeStoppedTasks against a cluster+
                // service pair) — auto-selecting a non-ECS workload (an S3
                // bucket, an EC2 instance) as the default target produces a
                // nonsense investigation against a fake "cluster" name.
                const ecsWorkloads = wlData.workloads.filter((w: any) => w.type === "ECS_SERVICE");
                setDiscoveredWorkloads(ecsWorkloads);
                if (!hasAutoPopulated.current && ecsWorkloads.length > 0) {
                  setTargetRegion(connectedAccount.region);
                  setTargetService(ecsWorkloads[0].name);
                  if (ecsWorkloads[0].cluster) setTargetCluster(ecsWorkloads[0].cluster);
                  hasAutoPopulated.current = true;
                }
              }
            }
          }
        }
      } catch {}

      // Query registered agents dynamically
      try {
        const agRes = await fetch(`${API_BASE}/v1/agents`, { headers });
        if (agRes.ok) {
          const agData = await agRes.json();
          const items = agData.items || [];
          setAvailableAgents(items);
          if (items.length > 0 && !selectedAgentId) {
            const connected = items.find((a: OnboardedAgent) => a.status === "CONNECTED") || items[0];
            setSelectedAgentId(connected.id);
          }
        }
      } catch (err) {
        console.error("Failed to load onboarded agents", err);
      }
    } catch (err) {
      console.error("Failed to load incidents", err);
    } finally {
      setLoading(false);
    }
  }, [selectedIncidentId, selectedAgentId, tenantId, operatorId]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    if (selectedIncidentId) {
      const selected = incidents.find((i) => i.id === selectedIncidentId);
      const svc = selected?.service ? selected.service.split("/").pop() || selected.service : targetService;
      setChatContext({
        investigationId: selectedIncidentId,
        service: svc,
        sourcePage: "Investigations"
      });
    }
  }, [selectedIncidentId, incidents, targetService, setChatContext]);

  // ADR-0007 Phase C1b: historical/post-hoc swarm topology — fires whenever
  // the selected incident changes to something NOT currently live-streaming
  // (isInvestigating guards that: it's set true synchronously at the start
  // of every trigger handler, before selectedIncidentId even changes, so a
  // just-triggered live investigation's own SSE-built swarmData is never
  // raced/overwritten by this fetch). Resolves quietly to {isSwarm:false}
  // for the overwhelming majority of ordinary investigations, which clears
  // swarmData back to null — i.e. the flat liveSteps list, unchanged.
  useEffect(() => {
    if (!selectedIncidentId || !tenantId || isInvestigating) return;
    let cancelled = false;
    (async () => {
      try {
        const trace = await fetchSwarmTrace(selectedIncidentId, tenantId, operatorId);
        if (cancelled) return;
        setSwarmData(trace.isSwarm ? mapSwarmTraceToTopology(trace) : null);
      } catch (err) {
        console.error("Failed to fetch swarm trace", err);
        if (!cancelled) setSwarmData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIncidentId, tenantId, operatorId, isInvestigating]);

  // 2. Trigger dynamic autonomous investigation
  const handleTriggerInvestigation = async (overrideParams?: {
    service?: string;
    cluster?: string;
    region?: string;
    severity?: string;
    alertDescription?: string;
    agentId?: string;
  }) => {
    const sName = overrideParams?.service || targetService;
    const cName = overrideParams?.cluster || targetCluster;
    const reg = overrideParams?.region || targetRegion;
    const sev = overrideParams?.severity || targetSeverity;
    const alertDesc = overrideParams?.alertDescription || targetAlertDesc;
    const agId = overrideParams?.agentId || selectedAgentId || undefined;

    setIsInvestigating(true);
    setLiveSteps([]);
    setRootCause(null);
    setPendingApprovalId(null);
    setSwarmData(null);
    swarmActiveRef.current = false;

    try {
      const res = await fetch(`${API_BASE}/v1/incidents/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId || "",
          "x-operator-id": operatorId || ""
        },
        body: JSON.stringify({
          service: sName,
          cluster: cName,
          region: reg,
          severity: sev,
          alertDescription: alertDesc,
          agentId: agId
        })
      });

      if (res.ok) {
        const data = await res.json();
        const incident = data.incident;
        const investigation = data.investigation;
        const session = data.session;

        // Prepend new incident to state
        setIncidents((prev) => [incident, ...prev.filter((i) => i.id !== incident.id)]);
        setSelectedIncidentId(incident.id);
        setActiveSessionId(session.sessionId);

        // Connect to live Server-Sent Events stream
        subscribeToLiveStream(investigation.id, session.sessionId);
      } else {
        setIsInvestigating(false);
      }
    } catch (err) {
      console.error("Failed to trigger investigation", err);
      setIsInvestigating(false);
    }
  };

  // Conversational target resolution: send the operator's message, and
  // either relay the agent's clarifying question or, once resolved, actually
  // launch the real investigation against the real service it identified.
  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || resolvingTarget || isInvestigating || !tenantId) return;

    const nextTurns = [...chatTurns, { role: "operator" as const, text }];
    setChatTurns(nextTurns);
    setChatInput("");
    setResolvingTarget(true);
    // A fresh conversation describing a new issue shouldn't sit next to a
    // stale result panel from whatever incident was last selected — clear
    // it the moment the operator starts describing something new.
    setLiveSteps([]);
    setRootCause(null);
    setPendingApprovalId(null);
    setSwarmData(null);
    swarmActiveRef.current = false;

    try {
      const res = await fetch(`${API_BASE}/v1/investigations/resolve-target`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "x-operator-id": operatorId || ""
        },
        body: JSON.stringify({ conversation: nextTurns })
      });

      const data = await res.json();

      // Not every message is an investigation request — a meta-question
      // ("is this runtime responding"), small talk, or an explicit "nothing's
      // wrong" should get a direct answer, not a fabricated incident. See
      // apps/api/src/routes/investigations.ts's resolve-target outcome 1.
      if (data.notActionable) {
        setChatTurns((prev) => [...prev, { role: "agent", text: data.response || "Nothing to investigate there." }]);
        return;
      }

      if (!res.ok || data.needsClarification) {
        setChatTurns((prev) => [
          ...prev,
          { role: "agent", text: data.question || data?.error?.message || "Could you say more about what's wrong?" }
        ]);
        return;
      }

      setChatTurns((prev) => [
        ...prev,
        {
          role: "agent",
          text: `Got it — investigating "${data.service}" in cluster "${data.cluster}" (${data.region}). Starting now.`
        }
      ]);

      await handleTriggerInvestigation({
        service: data.service,
        cluster: data.cluster,
        region: data.region,
        severity: data.severity,
        alertDescription: data.alertDescription,
        agentId: selectedAgentId || undefined
      });
    } catch (err) {
      console.error("Failed to resolve investigation target", err);
      setChatTurns((prev) => [
        ...prev,
        { role: "agent", text: "Something went wrong reaching the reasoning model — mind trying again?" }
      ]);
    } finally {
      setResolvingTarget(false);
    }
  };

  // Real incident closure — the product previously had no way to mark an
  // incident resolved at all.
  const handleResolveIncident = async (incidentId: string) => {
    if (!tenantId) return;
    try {
      const res = await fetch(`${API_BASE}/v1/incidents/${incidentId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "x-operator-id": operatorId || ""
        },
        body: JSON.stringify({ resolvedBy: session?.operatorName || operatorId })
      });
      if (res.ok) {
        const data = await res.json();
        setIncidents((prev) => prev.map((inc) => (inc.id === incidentId ? { ...inc, status: data.incident.status } : inc)));
      }
    } catch (err) {
      console.error("Failed to resolve incident", err);
    }
  };

  // 3. Start investigation for existing incident
  const handleStartInvestigation = async () => {
    if (!selectedIncidentId) return;
    setIsInvestigating(true);
    setLiveSteps([]);
    setRootCause(null);
    setPendingApprovalId(null);
    setSwarmData(null);
    swarmActiveRef.current = false;

    try {
      const res = await fetch(`${API_BASE}/v1/investigations/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId || "",
          "x-operator-id": operatorId || ""
        },
        body: JSON.stringify({
          incidentId: selectedIncidentId,
          agentId: selectedAgentId || undefined
        })
      });

      if (res.ok) {
        const data = await res.json();
        setIncidents((prev) =>
          prev.map((inc) =>
            inc.id === selectedIncidentId
              ? { ...inc, status: "INVESTIGATING", investigationStatus: "INVESTIGATING" }
              : inc
          )
        );
        setActiveSessionId(data.sessionId);
        subscribeToLiveStream(data.investigationId, data.sessionId);
      } else {
        setIsInvestigating(false);
      }
    } catch (err) {
      console.error("Failed to start investigation", err);
      setIsInvestigating(false);
    }
  };

  // 4. Live Server-Sent Events (SSE) Stream Subscription
  const subscribeToLiveStream = (investigationId: string, sessionId: string) => {
    const sse = new EventSource(
      `${API_BASE}/v1/investigations/${investigationId}/stream?sessionId=${sessionId}`
    );

    // ADR-0007 Phase C1b: the very first event of a swarm-mode investigation
    // is a STATUS event carrying `data.mode === "swarm"` (see
    // hermesAgentAdapter.ts's runSwarmInvestigation()) — this "status" event
    // type was never listened to at all before this feature, since nothing
    // else on this page needed it.
    sse.addEventListener("status", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed?.data?.mode === "swarm") {
          swarmActiveRef.current = true;
          setSwarmData({ workers: [], verifier: null, synthesizer: null, fellBack: false });
        }
      } catch (err) {
        console.error("Error parsing status SSE", err);
      }
    });

    const agentNameFor = (id: string | undefined) =>
      (id && availableAgents.find((a) => a.id === id)?.name) || id || undefined;

    // Routes a swarm-shaped STEP into swarmData instead of/alongside the flat
    // liveSteps list. Any toolName seen AFTER swarm mode was detected that
    // ISN'T swarm-shaped means runInvestigation()'s own fallback chain
    // abandoned the swarm attempt and moved on to the adaptive/fixed-script
    // tier within the same SSE session — mark fellBack and flip
    // swarmActiveRef off so subsequent steps flow only into the ordinary
    // flat list, exactly as they would for a non-swarm investigation.
    const routeSwarmStep = (toolName: string, assignee: string | undefined) => {
      if (toolName === "hermes_kanban_swarm_create") return;
      if (toolName.startsWith("swarm_investigator:")) {
        const tool = toolName.slice("swarm_investigator:".length);
        const agentName = agentNameFor(assignee);
        setSwarmData((prev) => {
          if (!prev) return prev;
          const exists = prev.workers.some((w) => w.key === tool);
          const workers = exists
            ? prev.workers.map((w) =>
                w.key === tool ? { ...w, status: "running" as const, agentId: assignee, agentName } : w
              )
            : [...prev.workers, { key: tool, toolName: tool, agentId: assignee, agentName, status: "running" as const }];
          return { ...prev, workers };
        });
        return;
      }
      if (toolName === "swarm_verifier") {
        setSwarmData((prev) =>
          prev ? { ...prev, verifier: { agentId: assignee, agentName: agentNameFor(assignee), status: "running" } } : prev
        );
        return;
      }
      if (toolName === "swarm_synthesizer") {
        setSwarmData((prev) =>
          prev ? { ...prev, synthesizer: { agentId: assignee, agentName: agentNameFor(assignee), status: "running" } } : prev
        );
        return;
      }
      // Not a swarm-shaped toolName — the swarm attempt was abandoned.
      swarmActiveRef.current = false;
      setSwarmData((prev) => {
        if (!prev) return prev;
        const failRunning = <T extends { status: SwarmNodeStatus }>(n: T | null): T | null =>
          n && n.status === "running" ? { ...n, status: "failed" as const } : n;
        return {
          ...prev,
          fellBack: true,
          workers: prev.workers.map((w) => (w.status === "running" ? { ...w, status: "failed" as const } : w)),
          verifier: failRunning(prev.verifier),
          synthesizer: failRunning(prev.synthesizer)
        };
      });
    };

    sse.addEventListener("step", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const stepNum = parsed.data.step;
        const toolName = parsed.data.toolName;
        setLiveSteps((prev) => {
          const exists = prev.find((s) => s.step === stepNum);
          if (exists) {
            return prev.map((s) => (s.step === stepNum ? { ...s, toolName, status: "running" } : s));
          }
          return [...prev, { step: stepNum, toolName, status: "running" }];
        });
        if (swarmActiveRef.current) {
          routeSwarmStep(toolName, parsed.data.assignee);
        }
      } catch (err) {
        console.error("Error parsing step SSE", err);
      }
    });

    // ADR-0007 Phase C1b live-progress feature: fires WHILE a swarm worker/
    // verifier/synthesizer's (or the adaptive tier's) own oneshot call is
    // still running — see packages/runtime/src/swarmProgressPoller.ts. Purely
    // additive: never changes a node's status (only STEP/OBSERVATION/
    // root_cause do that), so if this event is ever absent (an older backend
    // build, a polling failure server-side) every existing STEP/OBSERVATION-
    // driven render stays exactly as it was before this feature existed.
    sse.addEventListener("progress", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const toolName: string | undefined = parsed.data.toolName;
        const calledTool: string | undefined = parsed.data.calledTool;
        if (!toolName || !calledTool) return;

        if (swarmActiveRef.current && toolName.startsWith("swarm_investigator:")) {
          const tool = toolName.slice("swarm_investigator:".length);
          setSwarmData((prev) =>
            prev
              ? {
                  ...prev,
                  workers: prev.workers.map((w) =>
                    w.key === tool ? { ...w, progress: [...(w.progress || []), calledTool] } : w
                  )
                }
              : prev
          );
        } else if (swarmActiveRef.current && toolName === "swarm_verifier") {
          setSwarmData((prev) =>
            prev && prev.verifier
              ? { ...prev, verifier: { ...prev.verifier, progress: [...(prev.verifier.progress || []), calledTool] } }
              : prev
          );
        } else if (swarmActiveRef.current && toolName === "swarm_synthesizer") {
          setSwarmData((prev) =>
            prev && prev.synthesizer
              ? { ...prev, synthesizer: { ...prev.synthesizer, progress: [...(prev.synthesizer.progress || []), calledTool] } }
              : prev
          );
        } else if (!swarmActiveRef.current) {
          // Non-swarm (adaptive tier) progress — updates the matching flat
          // liveSteps card's single "currently:" line instead.
          setLiveSteps((prev) =>
            prev.map((s) =>
              s.toolName === toolName && s.status === "running"
                ? { ...s, progressLine: `Currently calling: ${calledTool}` }
                : s
            )
          );
        }
      } catch (err) {
        console.error("Error parsing progress SSE", err);
      }
    });

    sse.addEventListener("observation", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const stepNum = parsed.data.step;
        setLiveSteps((prev) =>
          prev.map((s) =>
            s.step === stepNum
              ? { ...s, status: "completed", observation: parsed.data.observation }
              : s
          )
        );

        const toolName: string | undefined = parsed.data.toolName;
        if (swarmActiveRef.current && toolName?.startsWith("swarm_investigator:")) {
          const tool = toolName.slice("swarm_investigator:".length);
          setSwarmData((prev) =>
            prev
              ? {
                  ...prev,
                  workers: prev.workers.map((w) =>
                    w.key === tool
                      ? { ...w, status: "completed" as const, finding: parsed.data.observation, evidence: parsed.data.evidence }
                      : w
                  )
                }
              : prev
          );
        } else if (swarmActiveRef.current && toolName === "swarm_verifier") {
          setSwarmData((prev) =>
            prev && prev.verifier
              ? { ...prev, verifier: { ...prev.verifier, status: "completed", finding: parsed.data.observation } }
              : prev
          );
        }
        // toolName === "swarm_synthesizer" OBSERVATION events are per-line
        // narrative, not a completion signal — the synthesizer node's
        // completion comes from the root_cause listener below.
      } catch (err) {
        console.error("Error parsing observation SSE", err);
      }
    });

    sse.addEventListener("evidence", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const evData = parsed.data;
        setLiveSteps((prev) => {
          // If latest running step has no evidence, attach to it
          const runningIdx = prev.findLastIndex((s) => s.status === "running");
          if (runningIdx >= 0) {
            return prev.map((s, idx) =>
              idx === runningIdx
                ? {
                    ...s,
                    status: "completed",
                    evidenceId: evData.evidenceId,
                    observation: evData.observation
                  }
                : s
            );
          }
          return [
            ...prev,
            {
              step: prev.length + 1,
              toolName: evData.source || "AWS_INSPECTION",
              status: "completed",
              evidenceId: evData.evidenceId,
              observation: evData.observation
            }
          ];
        });
      } catch (err) {
        console.error("Error parsing evidence SSE", err);
      }
    });

    sse.addEventListener("root_cause", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setRootCause(parsed.data);
        setIsInvestigating(false);
        if (swarmActiveRef.current) {
          setSwarmData((prev) =>
            prev
              ? {
                  ...prev,
                  synthesizer: {
                    agentId: prev.synthesizer?.agentId,
                    agentName: prev.synthesizer?.agentName,
                    status: "completed",
                    finding: parsed.data.finding
                  }
                }
              : prev
          );
        }
      } catch (err) {
        console.error("Error parsing root_cause SSE", err);
      }
    });

    sse.addEventListener("proposal", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.data?.remediation?.parameters) {
          setPendingApprovalId(parsed.data.approvalId || "pending");
        }
      } catch (err) {
        console.error("Error parsing proposal SSE", err);
      }
    });

    sse.addEventListener("error", () => {
      setIsInvestigating(false);
      sse.close();
    });
  };

  const selectedIncident = incidents.find((i) => i.id === selectedIncidentId);
  const selectedAgent = availableAgents.find((a) => a.id === selectedAgentId) || availableAgents[0];

  // Extracted, byte-identical to what this page rendered before the swarm
  // topology view existed — reused for the ordinary (non-swarm) flat list AND
  // for the fallback-tier steps shown beneath a fallen-back swarm attempt, so
  // there is exactly one place this markup is defined.
  const renderStepCards = (steps: LiveStep[]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {steps.map((step) => {
        const isHighlighted = highlightedEvidenceId === step.evidenceId;
        return (
          <div
            key={step.step}
            id={step.evidenceId}
            style={{
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              border: isHighlighted ? "2px solid #2563eb" : "1px solid var(--warm-gray-border)",
              backgroundColor: isHighlighted ? "#eff6ff" : "#faf9f7",
              transition: "all 0.2s ease"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", fontWeight: 600 }}>
                <span style={{ color: step.status === "running" ? "#d97706" : "#16a34a" }}>
                  {step.status === "running" ? "Running Step " + step.step + ":" : "Step " + step.step + ":"}
                </span>
                <code>{step.toolName}</code>
              </div>
              {step.evidenceId && (
                <span
                  style={{
                    fontSize: "10px",
                    fontFamily: "var(--font-mono)",
                    background: "#e5e7eb",
                    padding: "2px 6px",
                    borderRadius: "4px"
                  }}
                >
                  {step.evidenceId}
                </span>
              )}
            </div>
            {step.status === "running" && step.progressLine && (
              <div style={{ fontSize: "11.5px", color: "#d97706", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
                {step.progressLine}
              </div>
            )}
            {step.observation && (
              <div style={{ fontSize: "12px", color: "var(--near-black-ink)", marginTop: "4px" }}>
                {step.observation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--near-black-ink)",
                background: "var(--light-warm-gray)",
                border: "1px solid var(--warm-gray-border)",
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
                textTransform: "uppercase"
              }}
            >
              Autonomous SRE Diagnostics
            </span>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: selectedAgent?.status === "CONNECTED" ? "#16a34a" : "#ca8a04",
                background: selectedAgent?.status === "CONNECTED" ? "#ecfdf5" : "#fefce8",
                border: selectedAgent?.status === "CONNECTED" ? "1px solid #bbf7d0" : "1px solid #fef08a",
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
                textTransform: "uppercase"
              }}
            >
              Agent: {selectedAgent ? `${selectedAgent.name} (${selectedAgent.type}) · ${selectedAgent.status}` : "Dynamic Agent"}
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Investigations & Diagnostics
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Live agent activity, real AWS telemetry correlation, and cryptographically governed root-cause analysis.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {availableAgents.length > 0 && (
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              style={{ padding: "6px 10px", fontSize: "12.5px", borderRadius: "var(--radius-sm)", border: "1px solid var(--warm-gray-border)", background: "#ffffff" }}
            >
              {availableAgents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.type} · {ag.status})
                </option>
              ))}
            </select>
          )}

          {selectedIncident && (
            <button
              type="button"
              onClick={handleStartInvestigation}
              disabled={isInvestigating}
              className="btn-secondary"
              style={{ fontSize: "13px" }}
            >
              Re-investigate Selected
            </button>
          )}
        </div>
      </div>

      {/* Conversational Investigation Trigger */}
      <div className="harvey-card" style={{ padding: "20px", background: "#fdfdfc", border: "1px solid var(--warm-gray-border)" }}>
        <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)", marginBottom: "12px" }}>
          Describe the Issue
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "320px", overflowY: "auto", marginBottom: "12px", paddingRight: "4px" }}>
          {chatTurns.map((turn, i) => (
            <div
              key={i}
              style={{
                alignSelf: turn.role === "operator" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                padding: "9px 13px",
                borderRadius: "var(--radius-md, 10px)",
                fontSize: "13.5px",
                lineHeight: 1.45,
                background: turn.role === "operator" ? "var(--near-black-ink)" : "#f1f0ed",
                color: turn.role === "operator" ? "#ffffff" : "var(--near-black-ink)"
              }}
            >
              {turn.text}
            </div>
          ))}
          {resolvingTarget && (
            <div style={{ alignSelf: "flex-start", fontSize: "12px", color: "var(--mid-warm-gray)", fontStyle: "italic" }}>
              thinking...
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleChatSend();
          }}
          style={{ display: "flex", gap: "8px" }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="e.g. starvision-motors is throwing 5xx errors"
            disabled={resolvingTarget || isInvestigating}
            style={{ flex: 1, padding: "10px 12px", fontSize: "13.5px", borderRadius: "var(--radius-sm)", border: "1px solid var(--warm-gray-border)", background: "#ffffff" }}
          />
          <button
            type="submit"
            disabled={resolvingTarget || isInvestigating || !chatInput.trim()}
            className="btn-primary"
            style={{ fontSize: "13px", padding: "10px 18px" }}
          >
            {isInvestigating ? "Investigating..." : "Send"}
          </button>
        </form>
      </div>

      {/* 2. Incidents List Table */}
      <div className="harvey-card" style={{ padding: "0" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--warm-gray-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
            Cloud Incidents in PostgreSQL
          </div>
          <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)" }}>
            Showing <strong>{incidents.length}</strong> logged incidents
          </div>
        </div>

        {incidents.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#faf9f7", borderBottom: "1px solid var(--warm-gray-border)", textAlign: "left" }}>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Severity</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Incident ID</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Workload / Service</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Region</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}>Logged At</th>
                  <th style={{ padding: "12px 16px", fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr
                    key={inc.id}
                    onClick={() => setSelectedIncidentId(inc.id)}
                    style={{
                      cursor: "pointer",
                      borderBottom: "1px solid var(--warm-gray-border)",
                      backgroundColor: selectedIncidentId === inc.id ? "#f5f4f0" : "transparent"
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <span className={`status-pill ${inc.severity.toLowerCase()}`}>
                        {inc.severity}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                      {inc.id}
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 500 }}>
                      {inc.service}
                    </td>
                    <td style={{ padding: "12px 16px" }}>{inc.provider}</td>
                    <td style={{ padding: "12px 16px" }}>{inc.region}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="status-pill active">{inc.status}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--mid-warm-gray)", fontSize: "12px" }}>
                      {new Date(inc.createdAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {inc.status !== "RESOLVED" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResolveIncident(inc.id);
                          }}
                          className="btn-secondary"
                          style={{ fontSize: "11.5px", padding: "4px 10px" }}
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: "36px 20px", textAlign: "center" }}>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "6px" }}>
              No Active Incidents Logged Yet
            </div>
            {/* Database empty state: incidents stored in postgresql incident table */}
            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", maxWidth: "560px", margin: "0 auto" }}>
              No active incidents recorded for this workspace. Describe what's wrong in the box above to start a real investigation.
            </p>
          </div>
        )}
      </div>

      {/* 3. Operational Investigation Workspace */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: "1.5rem" }}>
        {/* Left Column: Live Agent Activity Stream */}
        <div className="harvey-card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
              Live Agent Execution Stream
            </div>
            <span className="status-pill active" style={{ fontSize: "10.5px" }}>
              {isInvestigating ? "Live Stream Active" : "Stream Idle"}
            </span>
          </div>

          {/* Real-time diagnostic steps stream; observations persisted to incident_evidence */}
          <p style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", marginBottom: "16px" }}>
            Real-time diagnostic events and telemetry correlation for active workloads.
          </p>

          {swarmData ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <SwarmTopologyView data={swarmData} />
              {swarmData.fellBack && liveSteps.length > 0 && (
                <div style={{ borderTop: "1px solid var(--warm-gray-border)", paddingTop: "14px" }}>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--near-black-ink)",
                      marginBottom: "10px"
                    }}
                  >
                    Fallback Investigation Steps
                  </div>
                  {renderStepCards(liveSteps)}
                </div>
              )}
            </div>
          ) : liveSteps.length > 0 ? (
            renderStepCards(liveSteps)
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--mid-warm-gray)", fontSize: "13px" }}>
              {isInvestigating
                ? "Connecting to live agent session stream..."
                : "No active investigation session in progress."}
            </div>
          )}
        </div>

        {/* Right Column: Root Cause & Linked Evidence View */}
        <div className="harvey-card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
              Root Cause & Evidence Links
            </div>
            {rootCause && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#16a34a",
                    background: "#ecfdf5",
                    border: "1px solid #bbf7d0",
                    padding: "2px 8px",
                    borderRadius: "12px"
                  }}
                >
                  Confidence: {Math.round(rootCause.confidence * 100)}%
                </span>
                {(() => {
                  const flaggedInconsistencies = rootCause.flaggedInconsistencies ?? [];
                  const label =
                    rootCause.confidenceLabel ??
                    deriveConfidenceLabelFallback(rootCause.confidence, rootCause.verificationStatus, flaggedInconsistencies);
                  const badgeKey = confidenceBadgeKey(label, rootCause.verificationStatus);
                  const colors = VERIFICATION_BADGE_COLORS[badgeKey];
                  return (
                    <span
                      title={label}
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: colors.color,
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        padding: "2px 8px",
                        borderRadius: "12px"
                      }}
                    >
                      {label}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>

          {rootCause ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Primary Finding Card */}
              <div style={{ padding: "16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#991b1b", textTransform: "uppercase", marginBottom: "4px" }}>
                  Root Cause Identified: {rootCause.finding}
                </div>
                <p style={{ fontSize: "13.5px", color: "#7f1d1d", margin: 0, lineHeight: 1.5 }}>
                  {rootCause.rootCause}
                </p>
              </div>

              {/* Verifier-flagged inconsistencies — only ever populated by the
                  swarm tier's independent verifier stage (see
                  hermesAgentAdapter.ts's runSwarmInvestigation). Shows the
                  actual disagreement text, not just a vague warning icon, so
                  the operator can judge for themselves whether it matters. */}
              {(rootCause.flaggedInconsistencies?.length ?? 0) > 0 && (
                <div style={{ padding: "16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#b45309", textTransform: "uppercase", marginBottom: "8px" }}>
                    Verifier Flagged {rootCause.flaggedInconsistencies!.length} Inconsistenc{rootCause.flaggedInconsistencies!.length === 1 ? "y" : "ies"}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {rootCause.flaggedInconsistencies!.map((issue, idx) => (
                      <li key={idx} style={{ fontSize: "13px", color: "#78350f", lineHeight: 1.5 }}>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Supporting Evidence IDs */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--mid-warm-gray)", marginBottom: "8px" }}>
                  Supporting Evidence IDs
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {rootCause.evidenceIds.map((evId) => (
                    <button
                      key={evId}
                      type="button"
                      onClick={() => {
                        setHighlightedEvidenceId(evId);
                        const el = document.getElementById(evId);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontFamily: "var(--font-mono)",
                        background: highlightedEvidenceId === evId ? "#2563eb" : "#ffffff",
                        color: highlightedEvidenceId === evId ? "#ffffff" : "#1d4ed8",
                        border: "1px solid #93c5fd",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      {evId}
                    </button>
                  ))}
                </div>
              </div>

              {/* Affected Resources */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--mid-warm-gray)", marginBottom: "8px" }}>
                  Affected Cloud Infrastructure
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {rootCause.affectedResources.map((arn) => (
                    <code
                      key={arn}
                      style={{
                        fontSize: "11px",
                        background: "#f3f4f6",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        wordBreak: "break-all"
                      }}
                    >
                      {arn}
                    </code>
                  ))}
                </div>
              </div>

              {/* Proposed Remediation & Link to Approvals.
                  Bug fix: this used to render the exact same "Human
                  Authorization: Required (Ed25519)" call-to-action for
                  EVERY finding that had a recommendedRemediation object at
                  all — including a healthy, LOW-risk, nothing-to-fix
                  finding whose "remediation" was really just the read-only
                  tool (e.g. aws_ecs_describe_services) that confirmed
                  nothing was wrong. Three genuinely different states now
                  render distinctly, reusing this app's own existing
                  status-color conventions (apps/web/src/app/approvals/page.tsx's
                  STATUS_COLORS — EXECUTED green / PENDING amber — rather
                  than inventing a new palette): */}
              {rootCause.recommendedRemediation && (() => {
                const remediation = rootCause.recommendedRemediation;
                const actionNeeded = remediation.actionNeeded ?? isMutatingToolName(remediation.toolName);

                if (!actionNeeded) {
                  // Honest "nothing to fix" state — no authorization prompt,
                  // no Approvals-queue link, because no approval was ever
                  // created for a read-only confirmation call.
                  return (
                    <div style={{ padding: "16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "var(--radius-sm)" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#166534", textTransform: "uppercase", marginBottom: "4px" }}>
                        No Remediation Needed
                      </div>
                      <div style={{ fontSize: "13px", color: "#14532d" }}>
                        Investigation confirmed no issue via <code>{remediation.toolName}</code> — service is healthy. No human action required.
                      </div>
                    </div>
                  );
                }

                if (remediation.requiresApproval) {
                  // A real mutation, classified HIGH/CRITICAL risk server-side
                  // (packages/policy's PolicyEngine path is unchanged by this
                  // fix) — the only state that should ever show an
                  // authorization call-to-action, styled with this app's
                  // existing PENDING/amber convention (apps/web/src/app/approvals/page.tsx)
                  // instead of the "everything is fine" green used above.
                  return (
                    <div style={{ padding: "16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "var(--radius-sm)" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#b45309", textTransform: "uppercase", marginBottom: "4px" }}>
                        Proposed Remediation — Approval Required
                      </div>
                      <div style={{ fontSize: "13px", color: "#78350f", marginBottom: "12px" }}>
                        Action: <code>{remediation.toolName}</code> •{" "}
                        <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", padding: "2px 7px", borderRadius: "var(--radius-sm)", fontWeight: 700 }}>
                          RISK: {remediation.riskLevel}
                        </span>{" "}
                        • Human Authorization: <strong>Required (Ed25519)</strong>
                      </div>
                      <Link
                        href="/approvals"
                        className="btn-primary"
                        style={{ fontSize: "12.5px", display: "inline-block", textDecoration: "none" }}
                      >
                        Authorize Remediation in Approvals Queue
                      </Link>
                    </div>
                  );
                }

                // A real mutation, but classified LOW/MEDIUM risk — recommended,
                // not gated. No fake authorization prompt, but also not the
                // "healthy" framing, since there IS something to consider.
                return (
                  <div style={{ padding: "16px", background: "var(--ivory-surface)", border: "1px solid var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--near-black-ink)", textTransform: "uppercase", marginBottom: "4px" }}>
                      Action Recommended — No Approval Required
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
                      Action: <code>{remediation.toolName}</code> • Risk Level: <strong>{remediation.riskLevel}</strong>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--mid-warm-gray)", fontSize: "13px" }}>
              No active root cause synthesis available. Launch an investigation to diagnose.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
