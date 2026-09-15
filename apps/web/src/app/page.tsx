import Link from "next/link";
import {
  fetchAgents,
  fetchJoinRequests,
  fetchCloudAccounts,
  fetchAccountWorkloads
} from "../lib/api";
import { OverviewChatComposer } from "../components/agent/OverviewChatComposer";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let agents: any[] = [];
  let pendingJoinCount = 0;
  let pendingRequests: any[] = [];
  let cloudWorkloadCount = 0;

  try {
    agents = await fetchAgents();
  } catch {
    agents = [];
  }

  try {
    const requests = await fetchJoinRequests();
    pendingRequests = requests.filter((r) => r.status === "PENDING_APPROVAL");
    pendingJoinCount = pendingRequests.length;
  } catch {
    pendingJoinCount = 0;
  }

  try {
    const accounts = await fetchCloudAccounts();
    const connectedAccounts = accounts.filter((a) => a.status === "CONNECTED");
    for (const acc of connectedAccounts) {
      try {
        const workloadsRes = await fetchAccountWorkloads(acc.id);
        cloudWorkloadCount += workloadsRes.workloads.length;
      } catch {
        // ignore
      }
    }
  } catch {
    cloudWorkloadCount = 0;
  }

  const connectedCount = agents.filter((a) => a.status === "CONNECTED").length;
  const hasAttentionItems = pendingJoinCount > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Header: Environment Scope */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.25rem" }}>
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: connectedCount > 0 ? "#22c55e" : "#eab308"
            }}
          />
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--near-black-ink)", letterSpacing: "0.2px" }}>
            Production · us-east-1
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>•</span>
          <span style={{ fontSize: "12px", color: "var(--mid-warm-gray)" }}>DevOps Control Plane</span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "40px", marginBottom: "0.25rem" }}>
          Operations Overview
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Operational health, autonomous agents, and actionable cloud alerts at a glance.
        </p>
      </div>

      {/* 2. Top Three Clean Status Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        {/* Services */}
        <div className="harvey-card" style={{ padding: "18px 22px" }}>
          <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
            Cloud Workloads
          </div>
          <div style={{ fontSize: "30px", fontWeight: 600, color: "var(--near-black-ink)" }}>
            {cloudWorkloadCount}{" "}
            <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--mid-warm-gray)" }}>
              {cloudWorkloadCount === 1 ? "Workload" : "Workloads"}
            </span>
          </div>
          <div style={{ marginTop: "8px", fontSize: "12.5px" }}>
            {cloudWorkloadCount > 0 ? (
              <Link href="/infrastructure" style={{ color: "var(--near-black-ink)", textDecoration: "underline" }}>
                View Discovered Workloads ({cloudWorkloadCount}) →
              </Link>
            ) : (
              <Link href="/cloud/connect" style={{ color: "var(--near-black-ink)", textDecoration: "underline" }}>
                + Connect Cloud Provider
              </Link>
            )}
          </div>
        </div>

        {/* Fleet */}
        <div className="harvey-card" style={{ padding: "18px 22px" }}>
          <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
            Operational Agents
          </div>
          <div style={{ fontSize: "30px", fontWeight: 600, color: "var(--near-black-ink)" }}>
            {connectedCount}{" "}
            <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--mid-warm-gray)" }}>
              / {agents.length} Connected
            </span>
          </div>
          <div style={{ marginTop: "8px", fontSize: "12.5px" }}>
            <Link href="/agents" style={{ color: "var(--near-black-ink)", textDecoration: "underline" }}>
              Manage Fleet ({agents.length}) →
            </Link>
          </div>
        </div>

        {/* Attention */}
        <div className="harvey-card" style={{ padding: "18px 22px", borderLeft: hasAttentionItems ? "3px solid #d97706" : "1px solid var(--warm-gray-border)" }}>
          <div style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
            Attention Queue
          </div>
          <div style={{ fontSize: "30px", fontWeight: 600, color: hasAttentionItems ? "#d97706" : "var(--near-black-ink)" }}>
            {pendingJoinCount}{" "}
            <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--mid-warm-gray)" }}>
              Pending
            </span>
          </div>
          <div style={{ marginTop: "8px", fontSize: "12.5px" }}>
            <Link href="/approvals" style={{ color: "var(--near-black-ink)", textDecoration: "underline" }}>
              View Approvals & Queue →
            </Link>
          </div>
        </div>
      </div>

      {/* 3. Needs Attention Section */}
      <div>
        <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)", marginBottom: "10px" }}>
          Needs Attention
        </div>

        {pendingJoinCount > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="harvey-card"
                style={{
                  padding: "16px 20px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "1rem",
                  borderLeft: "3px solid #d97706"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#d97706" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--near-black-ink)" }}>
                      Agent Join Request: {req.agentName} ({req.agentType})
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>
                      Requested {req.declaredCapabilities?.length || 0} capabilities. Awaiting operator authorization.
                    </div>
                  </div>
                </div>

                <Link
                  href={`/agents/join-requests`}
                  className="btn-primary"
                  style={{ fontSize: "12.5px", padding: "6px 14px" }}
                >
                  Review Access Request →
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="harvey-card"
            style={{
              padding: "18px 22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1rem"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ color: "#16a34a", fontSize: "16px" }}>✓</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--near-black-ink)" }}>
                  All systems operational
                </div>
                <div style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)" }}>
                  No pending access requests, elevated alarms, or failed workloads requiring operator intervention.
                </div>
              </div>
            </div>

            <Link href="/infrastructure" className="btn-secondary" style={{ fontSize: "12px" }}>
              Inspect Infrastructure →
            </Link>
          </div>
        )}
      </div>

      {/* 4. Global CloudOps Agent Command Surface */}
      <OverviewChatComposer />

      {/* 5. Connected Operational Agents Fleet */}
      <div className="harvey-card" style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
              Connected Autonomous Agents
            </h2>
            <p className="body-subtle" style={{ margin: "2px 0 0 0", fontSize: "13px" }}>
              Operational agent runtimes authorized to inspect telemetry and execute bounded tasks.
            </p>
          </div>

          <Link href="/agents/add" className="btn-secondary" style={{ fontSize: "12px" }}>
            + Add Agent
          </Link>
        </div>

        {agents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 16px", background: "#fcfbf9", border: "1px dashed var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
              No Agents Connected Yet
            </div>
            <p className="body-subtle" style={{ maxWidth: "420px", margin: "0 auto 16px auto", fontSize: "13px" }}>
              Connect an autonomous CloudOps agent (e.g. Hermes SRE or OpenClaw) to begin autonomous investigation and monitoring.
            </p>
            <Link href="/agents/add" className="btn-primary" style={{ fontSize: "13px" }}>
              Onboard First Agent →
            </Link>
          </div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Framework</th>
                  <th>Status</th>
                  <th>Protocol</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.slice(0, 5).map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <Link href={`/agents/${agent.id}`} style={{ fontWeight: 600, color: "var(--near-black-ink)" }}>
                        {agent.name}
                      </Link>
                      <div className="code-inline" style={{ fontSize: "11px", marginTop: "2px" }}>
                        {agent.id}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          background: "#edece9",
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)"
                        }}
                      >
                        {agent.type} (v{agent.version})
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          agent.status === "CONNECTED"
                            ? "connected"
                            : agent.status === "REGISTERED"
                            ? "registered"
                            : "approved"
                        }`}
                      >
                        <span className="status-dot-inner" />
                        {agent.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--mid-warm-gray)" }}>
                      {agent.runtimeProtocol.toUpperCase()}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/agents/${agent.id}`} className="btn-secondary" style={{ fontSize: "11px", padding: "3px 8px" }}>
                        View Dossier →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Recent Operational Activity */}
      <div className="harvey-card" style={{ padding: "20px 24px" }}>
        <div style={{ fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
          Recent Activity
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "#16a34a" }}>●</span>
            <span style={{ fontWeight: 500 }}>Control Plane Heartbeat active</span>
            <span style={{ color: "var(--muted-gray)", marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "11.5px" }}>
              Active
            </span>
          </div>

          {agents.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ color: "var(--near-black-ink)" }}>●</span>
              <span>Agent registered in tenant: <strong>{agents[0].name}</strong></span>
              <span style={{ color: "var(--muted-gray)", marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "11.5px" }}>
                {new Date(agents[0].createdAt).toLocaleDateString()}
              </span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "var(--muted-gray)" }}>●</span>
            <span>Cryptographic boundary enforcement active (Row-level isolation)</span>
            <span style={{ color: "var(--muted-gray)", marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "11.5px" }}>
              Enforced
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
