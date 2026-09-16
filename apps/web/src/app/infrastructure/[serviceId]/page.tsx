"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { useAgentChat } from "../../../context/AgentChatContext";
import { useOperator } from "../../../auth/OperatorContext";
import {
  fetchCloudAccounts,
  fetchAccountWorkloads,
  DiscoveredWorkload,
  CloudAccountItem
} from "../../../lib/api";

export default function ServiceDetailPage({ params }: { params: Promise<{ serviceId: string }> }) {
  const resolvedParams = use(params);
  const serviceId = decodeURIComponent(resolvedParams.serviceId);

  const { setChatContext, openChat } = useAgentChat();
  const { session } = useOperator();

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "logs" | "metrics" | "config" | "tasks">("overview");
  const [workload, setWorkload] = useState<DiscoveredWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<CloudAccountItem | null>(null);

  const loadWorkloadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const accounts = await fetchCloudAccounts(tenantId, operatorId);
      const connected = accounts.filter((a) => a.status === "CONNECTED");

      let found: DiscoveredWorkload | null = null;
      let matchedAccount: CloudAccountItem | null = null;

      for (const acc of connected) {
        try {
          const res = await fetchAccountWorkloads(acc.id, tenantId, operatorId);
          const match = res.workloads.find(
            (w) => w.name.toLowerCase() === serviceId.toLowerCase() || w.id === serviceId
          );
          if (match) {
            found = match;
            matchedAccount = acc;
            break;
          }
        } catch {
          // ignore individual account lookup failure
        }
      }

      setWorkload(found);
      setAccount(matchedAccount);

      setChatContext({
        service: serviceId,
        environment: "Production",
        region: found?.region || "us-east-1",
        sourcePage: `Service: ${serviceId}`
      });
    } catch {
      setWorkload(null);
    } finally {
      setLoading(false);
    }
  }, [serviceId, tenantId, operatorId, setChatContext]);

  useEffect(() => {
    loadWorkloadDetails();
  }, [loadWorkloadDetails]);

  const isProvisioned = workload !== null;
  const isHealthy = workload?.status === "HEALTHY";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Breadcrumbs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--mid-warm-gray)" }}>
          <Link href="/infrastructure" style={{ textDecoration: "underline" }}>
            Infrastructure
          </Link>
          <span>/</span>
          <span style={{ color: "var(--near-black-ink)", fontWeight: 500 }}>{serviceId}</span>
        </div>

        <Link href="/infrastructure" className="btn-secondary" style={{ fontSize: "12.5px" }}>
          Back to Services
        </Link>
      </div>

      {/* 2. Service Hero Card */}
      <div className="harvey-card" style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1.5rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "32px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                {serviceId}
              </h1>
              {loading ? (
                <span className="status-pill" style={{ fontSize: "11px" }}>CHECKING...</span>
              ) : isProvisioned ? (
                <span className={`status-pill ${isHealthy ? "connected" : "attention"}`} style={{ fontSize: "11px" }}>
                  <span className="status-dot-inner" />
                  {workload.status}
                </span>
              ) : (
                <span className="status-pill" style={{ fontSize: "11px", background: "#f3f4f6", color: "#6b7280" }}>
                  NOT PROVISIONED
                </span>
              )}
            </div>
            <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Production</span>
              <span>•</span>
              <span>{workload ? `${workload.type} (${workload.launchType || "Fargate"})` : "AWS Cloud Resource"}</span>
              <span>•</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{workload?.region || "us-east-1"}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Link
              href="/investigate"
              className="btn-primary"
              style={{ fontSize: "13px", textDecoration: "none" }}
            >
              Open in Investigations Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Unprovisioned / Loading State */}
      {!loading && !isProvisioned && (
        <div className="harvey-card" style={{ padding: "32px", textAlign: "center", background: "#fafaf9" }}>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "8px" }}>
            Workload Not Found or Unprovisioned
          </div>
          <p className="body-subtle" style={{ maxWidth: "540px", margin: "0 auto 20px auto", fontSize: "13.5px" }}>
            Workload &quot;{serviceId}&quot; is not registered or running in your connected AWS cloud accounts.
            CloudOps only displays verified, ground-truth telemetry from active infrastructure.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
            <Link href="/infrastructure" className="btn-primary" style={{ fontSize: "13px" }}>
              View Discovered Workloads
            </Link>
            <button
              type="button"
              onClick={() => openChat(`Check discovered workloads`)}
              className="btn-secondary"
              style={{ fontSize: "13px" }}
            >
              Ask CloudOps Agent
            </button>
          </div>
        </div>
      )}

      {/* Discovered Real Workload View */}
      {isProvisioned && workload && (
        <>
          {/* 3. Progressive Disclosure Tabs */}
          <div className="tab-navigation-bar">
            {(["overview", "config", "tasks"] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveTab(tabKey)}
                className={`tab-nav-btn ${activeTab === tabKey ? "active" : ""}`}
                style={{ textTransform: "capitalize" }}
              >
                {tabKey}
              </button>
            ))}
          </div>

          {/* 4. Tab Content */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* Ground-Truth Metrics Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                <div className="harvey-card" style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                    Running Tasks
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
                    {workload.runningCount ?? 0} / {workload.desiredCount ?? 0}
                  </div>
                  <div style={{ fontSize: "12px", color: isHealthy ? "#16a34a" : "#dc2626", marginTop: "2px" }}>
                    {workload.runningCount === workload.desiredCount ? "Desired capacity matched" : "Capacity mismatch"}
                  </div>
                </div>

                <div className="harvey-card" style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                    AWS Cluster
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "8px", fontFamily: "var(--font-mono)" }}>
                    {workload.cluster || "default"}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>ECS Fargate</div>
                </div>

                <div className="harvey-card" style={{ padding: "16px 20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                    Cloud Account
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "8px", fontFamily: "var(--font-mono)" }}>
                    {account?.accountId || "AWS"}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>Region: {workload.region}</div>
                </div>
              </div>

              {/* CloudOps Agent Operational Actions */}
              <div className="harvey-card" style={{ padding: "20px 24px", background: "#fcfbf9" }}>
                <h3 className="panel-title" style={{ marginBottom: "6px" }}>Autonomous Agent Operational Actions</h3>
                <p className="body-subtle" style={{ marginBottom: "14px", fontSize: "13px" }}>
                  Dispatch governed operational inspection routines for {serviceId}.
                </p>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <Link
                    href="/investigate"
                    className="btn-secondary"
                    style={{ fontSize: "13px", textDecoration: "none" }}
                  >
                    Investigate Incident
                  </Link>
                  <button
                    type="button"
                    onClick={() => openChat(`Check health of ${serviceId}`)}
                    className="btn-secondary"
                    style={{ fontSize: "13px" }}
                  >
                    Inspect Telemetry
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "config" && (
            <div className="harvey-card" style={{ padding: "24px" }}>
              <h3 className="panel-title" style={{ marginBottom: "12px" }}>Workload Configuration</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ color: "var(--mid-warm-gray)" }}>Task Definition:</span>
                  <span className="code-inline">{workload.taskDefinition || "N/A"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ color: "var(--mid-warm-gray)" }}>Resource Type:</span>
                  <span className="code-inline">{workload.type}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ color: "var(--mid-warm-gray)" }}>Cluster Name:</span>
                  <span className="code-inline">{workload.cluster || "default"}</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tasks" && (
            <div className="harvey-card" style={{ padding: "24px" }}>
              <h3 className="panel-title" style={{ marginBottom: "12px" }}>Discovered Task Replicas</h3>
              <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
                Active running count: <strong>{workload.runningCount ?? 0}</strong> of <strong>{workload.desiredCount ?? 0}</strong> desired.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
