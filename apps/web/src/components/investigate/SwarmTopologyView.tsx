"use client";

import React from "react";

/**
 * ADR-0007 Phase C1b: live + historical topology view for a Kanban Swarm
 * investigation (N parallel investigator workers -> 1 verifier -> 1
 * synthesizer). Purely presentational — `apps/web/src/app/investigate/page.tsx`
 * is responsible for building this shape from either the live SSE stream
 * (`mode: "swarm"` events) or the historical `GET
 * /v1/investigations/:id/swarm-trace` response, so this component has no
 * opinion about where its data came from.
 */

export type SwarmNodeStatus = "pending" | "running" | "completed" | "failed";

export interface SwarmWorkerNode {
  /** Stable identity across live/historical — the worker's own tool name. */
  key: string;
  toolName: string;
  agentId?: string | null;
  agentName?: string | null;
  status: SwarmNodeStatus;
  finding?: string | null;
  evidence?: string | null;
  /**
   * Live-only: real tool names this worker has actually called so far, in
   * call order, populated as "PROGRESS" SSE events arrive while this node is
   * still `status: "running"` (see investigate/page.tsx's progress listener
   * and packages/runtime/src/swarmProgressPoller.ts). Always undefined/empty
   * for a historical (swarm-trace) node — there is no live-only signal left
   * to replay once an investigation is over, and none is needed: the
   * worker's own `finding`/`evidence` already summarize what it did.
   */
  progress?: string[];
}

export interface SwarmRoleNode {
  agentId?: string | null;
  agentName?: string | null;
  status: SwarmNodeStatus;
  finding?: string | null;
  /** Live-only — see SwarmWorkerNode.progress. */
  progress?: string[];
}

export interface SwarmTopologyData {
  workers: SwarmWorkerNode[];
  verifier: SwarmRoleNode | null;
  synthesizer: SwarmRoleNode | null;
  /**
   * True once the swarm attempt was abandoned and `runInvestigation()`'s
   * own fallback chain moved on to the adaptive or fixed-script tier (see
   * hermesAgentAdapter.ts's runInvestigation()). Set live (by the SSE
   * handler in investigate/page.tsx, the instant a non-swarm-shaped step
   * arrives after swarm mode was detected) AND historically (by
   * mapSwarmTraceToTopology, inferred from investigator children existing
   * with no synthesizer child ever created — a synthesizer child only
   * exists once every worker AND the verifier stage succeeded). Still
   * never set for the case where the swarm fell back before creating even
   * one child run — a persisted swarm-trace row doesn't exist at all in
   * that case, so there's nothing to render historically either way.
   */
  fellBack: boolean;
}

const STATUS_STYLE: Record<SwarmNodeStatus, { bg: string; border: string; text: string; label: string }> = {
  pending: { bg: "var(--ivory-surface)", border: "var(--warm-gray-border)", text: "var(--mid-warm-gray)", label: "Pending" },
  running: { bg: "#fefce8", border: "#fef08a", text: "#ca8a04", label: "Running" },
  completed: { bg: "#ecfdf5", border: "#bbf7d0", text: "#16a34a", label: "Completed" },
  failed: { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", label: "Failed" }
};

/**
 * Reuses the exact role -> visual convention already shipped for the fleet
 * table's role selector (apps/web/src/app/agents/page.tsx): monospace,
 * capitalized, an indigo accent for any non-generalist role. There is no
 * separate color per role there (investigator/verifier/synthesizer all
 * share the one indigo accent) — matched here rather than inventing a new
 * per-role palette this codebase doesn't otherwise have.
 */
function RoleBadge({ role }: { role: "investigator" | "verifier" | "synthesizer" }) {
  return (
    <span
      style={{
        fontSize: "10px",
        fontFamily: "var(--font-mono)",
        padding: "2px 6px",
        borderRadius: "4px",
        border: "1px solid var(--warm-gray-border)",
        backgroundColor: "#eef2ff",
        color: "var(--dark-warm-gray)",
        textTransform: "capitalize"
      }}
    >
      {role}
    </span>
  );
}

function StatusPill({ status }: { status: SwarmNodeStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        color: s.text,
        background: s.bg,
        border: `1px solid ${s.border}`,
        padding: "2px 7px",
        borderRadius: "var(--radius-sm)",
        textTransform: "uppercase",
        letterSpacing: "0.4px"
      }}
    >
      {s.label}
    </span>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0" }}>
      <div style={{ width: "2px", height: "14px", background: "var(--warm-gray-border)" }} />
      <div
        style={{
          fontSize: "10.5px",
          color: "var(--mid-warm-gray)",
          fontFamily: "var(--font-mono)",
          padding: "2px 8px",
          whiteSpace: "nowrap"
        }}
      >
        {label}
      </div>
      <div style={{ width: "2px", height: "14px", background: "var(--warm-gray-border)" }} />
    </div>
  );
}

function NodeCard({
  title,
  role,
  agentName,
  status,
  finding,
  evidence,
  progress
}: {
  title: string;
  role: "investigator" | "verifier" | "synthesizer";
  agentName?: string | null;
  status: SwarmNodeStatus;
  finding?: string | null;
  evidence?: string | null;
  progress?: string[];
}) {
  const s = STATUS_STYLE[status];
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: "200px",
        maxWidth: "320px",
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${status === "pending" ? "var(--warm-gray-border)" : s.border}`,
        background: status === "pending" ? "var(--ivory-surface)" : s.bg,
        transition: "all 0.2s ease"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", gap: "6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <RoleBadge role={role} />
          <code style={{ fontSize: "11.5px", color: "var(--near-black-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </code>
        </div>
        <StatusPill status={status} />
      </div>
      <div style={{ fontSize: "11.5px", color: "var(--mid-warm-gray)", marginBottom: finding || (status === "running" && progress?.length) ? "6px" : 0 }}>
        {agentName || "Unassigned"}
      </div>
      {status === "running" && progress && progress.length > 0 && (
        <div
          style={{
            fontSize: "11px",
            color: "#ca8a04",
            fontFamily: "var(--font-mono)",
            marginBottom: "6px",
            lineHeight: 1.5
          }}
        >
          {progress.slice(0, -1).map((tool, i) => (
            <span key={i} style={{ opacity: 0.65 }}>
              {tool}
              {" → "}
            </span>
          ))}
          <span>calling {progress[progress.length - 1]}...</span>
        </div>
      )}
      {finding && (
        <div style={{ fontSize: "12px", color: "var(--near-black-ink)", lineHeight: 1.45 }}>{finding}</div>
      )}
      {evidence && (
        <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", marginTop: "4px", fontStyle: "italic" }}>
          {evidence}
        </div>
      )}
    </div>
  );
}

export function SwarmTopologyView({ data }: { data: SwarmTopologyData }) {
  const workersDone = data.workers.filter((w) => w.status === "completed").length;
  const workersFailed = data.workers.filter((w) => w.status === "failed").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--near-black-ink)" }}>
          Kanban Swarm Topology
        </div>
        <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", fontFamily: "var(--font-mono)" }}>
          {workersDone}/{data.workers.length} workers done{workersFailed > 0 ? ` · ${workersFailed} failed` : ""}
        </div>
      </div>

      {data.fellBack && (
        <div
          style={{
            padding: "10px 12px",
            marginBottom: "8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid #fef08a",
            background: "#fefce8",
            fontSize: "12px",
            color: "#92400e"
          }}
        >
          <strong>Swarm attempt did not complete</strong> — the investigation fell back to a single-agent
          (adaptive or fixed-script) run, shown below. The partial swarm activity above is what completed
          before the fallback.
        </div>
      )}

      {/* Tier 1: N parallel investigator workers, side by side — never stacked
          as if sequential, since the backend genuinely dispatches them via
          Promise.all. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {data.workers.length === 0 ? (
          <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", fontStyle: "italic", padding: "8px 0" }}>
            Dispatching investigator workers...
          </div>
        ) : (
          data.workers.map((w) => (
            <NodeCard
              key={w.key}
              title={w.toolName}
              role="investigator"
              agentName={w.agentName}
              status={w.status}
              finding={w.finding}
              evidence={w.evidence}
              progress={w.progress}
            />
          ))
        )}
      </div>

      <Connector label={`waits on all ${data.workers.length || "N"} worker(s)`} />

      {/* Tier 2: verifier, gated behind every worker. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <NodeCard
          title="swarm_verifier"
          role="verifier"
          agentName={data.verifier?.agentName}
          status={data.verifier?.status || "pending"}
          finding={data.verifier?.finding}
          progress={data.verifier?.progress}
        />
      </div>

      <Connector label="waits on verifier" />

      {/* Tier 3: synthesizer, gated behind the verifier — its finding IS the
          investigation's final root cause once available. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <NodeCard
          title="swarm_synthesizer"
          role="synthesizer"
          agentName={data.synthesizer?.agentName}
          status={data.synthesizer?.status || "pending"}
          finding={data.synthesizer?.finding}
          progress={data.synthesizer?.progress}
        />
      </div>
    </div>
  );
}
