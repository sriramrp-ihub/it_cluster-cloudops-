"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAgentChat } from "../../context/AgentChatContext";
import { useOperator } from "../../auth/OperatorContext";
import {
  fetchCloudAccounts,
  fetchAccountWorkloads,
  CloudAccountItem,
  DiscoveredWorkload
} from "../../lib/api";
import { AwsConnectModal } from "../cloud/connect/AwsConnectModal";

export default function InfrastructurePage() {
  const { setChatContext, openChat } = useAgentChat();
  const { session } = useOperator();

  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  const [accounts, setAccounts] = useState<CloudAccountItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [workloads, setWorkloads] = useState<DiscoveredWorkload[]>([]);
  const [loadingWorkloads, setLoadingWorkloads] = useState(false);
  const [sessionActive, setSessionActive] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "ECS_SERVICE" | "EC2_INSTANCE" | "RDS_DATABASE" | "S3_BUCKET">("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [backendUnavailable, setBackendUnavailable] = useState(false);

  // 1. Fetch connected cloud accounts and workloads
  const loadAccountsAndWorkloads = useCallback(async () => {
    try {
      setLoadingAccounts(true);
      const accList = await fetchCloudAccounts(tenantId, operatorId);
      setAccounts(accList);
      setBackendUnavailable(false);

      const connectedAccounts = accList.filter(
        (a) => a.provider.toLowerCase() === "aws" && a.status === "CONNECTED"
      );

      if (connectedAccounts.length > 0) {
        setChatContext({
          environment: "Production",
          region: connectedAccounts.map((a) => a.region).join(", "),
          sourcePage: "Infrastructure"
        });

        // Discover real workloads across ECS, EC2, RDS, and S3 for all connected accounts/regions
        setLoadingWorkloads(true);
        try {
          const results = await Promise.allSettled(
            connectedAccounts.map((acc) => fetchAccountWorkloads(acc.id, tenantId, operatorId))
          );

          const combinedWorkloads: DiscoveredWorkload[] = [];
          let anyActive = false;

          for (const res of results) {
            if (res.status === "fulfilled") {
              combinedWorkloads.push(...res.value.workloads);
              if (res.value.sessionActive) {
                anyActive = true;
              }
            }
          }

          // Deduplicate by workload id
          const seen = new Set<string>();
          const dedupedWorkloads = combinedWorkloads.filter((w) => {
            if (seen.has(w.id)) return false;
            seen.add(w.id);
            return true;
          });

          setWorkloads(dedupedWorkloads);
          setSessionActive(anyActive);
        } catch (workloadErr) {
          console.warn("Workload discovery query failed:", workloadErr);
          setWorkloads([]);
        } finally {
          setLoadingWorkloads(false);
        }
      } else {
        setWorkloads([]);
      }
    } catch (err: any) {
      setBackendUnavailable(true);
      console.warn("CloudOps Control Plane API is temporarily unreachable (port 3000):", err?.message || err);
    } finally {
      setLoadingAccounts(false);
    }
  }, [tenantId, operatorId, setChatContext]);

  useEffect(() => {
    loadAccountsAndWorkloads();
  }, [loadAccountsAndWorkloads]);

  const connectedAccounts = accounts.filter(
    (a) => a.provider.toLowerCase() === "aws" && a.status === "CONNECTED"
  );
  const connectedAccount = connectedAccounts[0];
  const connectedRegions = Array.from(new Set(connectedAccounts.map((a) => a.region)));

  // Filter workloads based on search, type tab, and status
  const filteredWorkloads = workloads.filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.cluster && w.cluster.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (w.instanceType && w.instanceType.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (w.taskDefinition && w.taskDefinition.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesType = typeFilter === "ALL" || w.type === typeFilter;

    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "HEALTHY" && w.status === "HEALTHY") ||
      (statusFilter === "PAUSED" && w.status === "PAUSED") ||
      (statusFilter === "ATTENTION" && w.status === "ATTENTION") ||
      (statusFilter === "STOPPED" && w.status === "STOPPED");

    return matchesSearch && matchesType && matchesStatus;
  });

  const ecsCount = workloads.filter((w) => w.type === "ECS_SERVICE").length;
  const ec2Count = workloads.filter((w) => w.type === "EC2_INSTANCE").length;
  const rdsCount = workloads.filter((w) => w.type === "RDS_DATABASE").length;
  const s3Count = workloads.filter((w) => w.type === "S3_BUCKET").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {backendUnavailable && (
        <div
          style={{
            padding: "12px 18px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "var(--radius-sm)",
            color: "#991b1b",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span>
            ⚠️ <strong>Control Plane API Offline:</strong> Could not connect to API server at http://localhost:3000. Start it with <code>npm run dev:api</code>.
          </span>
          <button
            type="button"
            onClick={() => loadAccountsAndWorkloads()}
            className="btn-secondary"
            style={{ fontSize: "11px", padding: "4px 8px" }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* 1. Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--near-black-ink)",
                background: "#edece9",
                border: "1px solid var(--warm-gray-border)",
                padding: "2px 7px",
                borderRadius: "var(--radius-sm)",
                textTransform: "uppercase"
              }}
            >
              Cloud Infrastructure
            </span>
            {connectedAccount && (
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  color: "#15803d",
                  background: "#dcfce7",
                  border: "1px solid #bbf7d0",
                  padding: "2px 7px",
                  borderRadius: "var(--radius-sm)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#16a34a" }} />
                AWS {connectedRegions.join(" • ") || connectedAccount.region}
              </span>
            )}
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Infrastructure & Workloads
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Overview of connected cloud environments, container services, compute, databases, and storage.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => openChat(connectedAccount ? `Inspect all running and paused workloads in AWS ${connectedAccount.region}` : "Show me the running services.")}
            className="btn-secondary"
            style={{ fontSize: "13px" }}
          >
            Ask CloudOps about Infrastructure →
          </button>
          <button
            type="button"
            onClick={() => setIsConnectModalOpen(true)}
            className="btn-primary"
            style={{ fontSize: "13px" }}
          >
            {connectedAccount ? "Configure Provider" : "+ Connect Cloud Provider"}
          </button>
        </div>
      </div>

      {/* 2. Top: Cloud Environments Card */}
      <div className="harvey-card" style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1.5rem", marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "20px" }}>☁️</span>
              <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
                Cloud Environments
              </h2>
            </div>
            <p className="body-subtle" style={{ margin: 0, fontSize: "13.5px" }}>
              Cross-account IAM and workload federation configured for this tenant.
            </p>
          </div>

          <Link href="/cloud/connect" className="btn-secondary" style={{ fontSize: "12px" }}>
            Configure Providers →
          </Link>
        </div>

        {loadingAccounts ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--mid-warm-gray)" }}>
            Checking cloud environment connections...
          </div>
        ) : connectedAccount ? (
          /* Real Connected Environment Display */
          <div
            style={{
              padding: "20px",
              background: "#ffffff",
              border: "1px solid #bbf7d0",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "16px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "24px" }}>☁️</span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: 700, fontSize: "16px", color: "var(--near-black-ink)" }}>
                      Amazon Web Services
                    </span>
                    <span
                      style={{
                        background: "#dcfce7",
                        color: "#15803d",
                        border: "1px solid #bbf7d0",
                        fontSize: "11px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "12px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px"
                      }}
                    >
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#16a34a" }} />
                      Connected
                    </span>
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>
                    Active connection via AWS STS GetCallerIdentity. Zero credentials stored in database.
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => loadAccountsAndWorkloads()}
                  disabled={loadingWorkloads}
                  className="btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 12px" }}
                >
                  {loadingWorkloads ? "Scanning..." : "↻ Refresh Discovery"}
                </button>
                <Link
                  href="/cloud/connect"
                  className="btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 12px" }}
                >
                  Connection Settings
                </Link>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
                padding: "12px 16px",
                background: "#fcfdfc",
                border: "1px solid var(--warm-gray-border)",
                borderRadius: "var(--radius-sm)"
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
                  Account ID
                </div>
                <div className="mono" style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  {connectedAccount.accountId}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
                  Target Region{connectedRegions.length > 1 ? "s" : ""}
                </div>
                <div className="mono" style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  {connectedRegions.join(", ") || connectedAccount.region}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
                  Discovered Resources
                </div>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                  {workloads.length} Workload{workloads.length === 1 ? "" : "s"}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)" }}>
                  Session Security
                </div>
                <div style={{ fontSize: "12.5px", color: sessionActive ? "#15803d" : "#b45309", fontWeight: 500 }}>
                  {sessionActive ? "In-Memory Session Active" : "Session Expired (Needs Reconnect)"}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Disconnected State */
          <div
            style={{
              marginTop: "10px",
              padding: "24px 20px",
              background: "#fcfbf9",
              border: "1px dashed var(--warm-gray-border)",
              borderRadius: "var(--radius-sm)",
              textAlign: "center"
            }}
          >
            <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#edece9", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "18px", marginBottom: "12px" }}>
              ☁️
            </div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
              No Cloud Environments Connected Yet
            </div>
            <p className="body-subtle" style={{ maxWidth: "460px", margin: "0 auto 18px auto", fontSize: "13px" }}>
              Connect an Amazon Web Services (AWS), Google Cloud (GCP), or Microsoft Azure account to automatically discover ECS tasks, EKS pods, and RDS clusters.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setIsConnectModalOpen(true)}
                className="btn-primary"
                style={{ fontSize: "13px" }}
              >
                Connect Cloud Account →
              </button>
              <button
                type="button"
                onClick={() => openChat("What services are unhealthy?")}
                className="btn-secondary"
                style={{ fontSize: "13px" }}
              >
                Ask Agent to Verify →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Services Directory (Workload Services Catalog) */}
      <div className="harvey-card" style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "18px" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", fontWeight: 400, color: "var(--near-black-ink)", margin: 0 }}>
              Workload Services Catalog
            </h2>
            <p className="body-subtle" style={{ margin: "2px 0 0 0", fontSize: "13px" }}>
              {connectedAccount
                ? `Everything discovered from AWS ${connectedAccount.region}: ECS container services, EC2 compute, RDS databases, and S3.`
                : "Discovered microservices and container deployments."}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="text"
              placeholder="Search workloads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input"
              style={{ width: "200px", fontSize: "13px", padding: "6px 10px" }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="form-input"
              style={{ fontSize: "13px", padding: "6px 10px" }}
            >
              <option value="ALL">All Statuses</option>
              <option value="HEALTHY">Healthy</option>
              <option value="PAUSED">Paused (desired=0)</option>
              <option value="ATTENTION">Attention</option>
              <option value="STOPPED">Stopped</option>
            </select>
          </div>
        </div>

        {/* Resource Type Category Tabs */}
        {connectedAccount && workloads.length > 0 && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "12px" }}>
            <button
              type="button"
              onClick={() => setTypeFilter("ALL")}
              className={`tab-nav-btn ${typeFilter === "ALL" ? "active" : ""}`}
              style={{ fontSize: "12px", padding: "4px 10px" }}
            >
              All Resources ({workloads.length})
            </button>
            {ecsCount > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter("ECS_SERVICE")}
                className={`tab-nav-btn ${typeFilter === "ECS_SERVICE" ? "active" : ""}`}
                style={{ fontSize: "12px", padding: "4px 10px" }}
              >
                ECS Containers ({ecsCount})
              </button>
            )}
            {ec2Count > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter("EC2_INSTANCE")}
                className={`tab-nav-btn ${typeFilter === "EC2_INSTANCE" ? "active" : ""}`}
                style={{ fontSize: "12px", padding: "4px 10px" }}
              >
                EC2 Compute ({ec2Count})
              </button>
            )}
            {rdsCount > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter("RDS_DATABASE")}
                className={`tab-nav-btn ${typeFilter === "RDS_DATABASE" ? "active" : ""}`}
                style={{ fontSize: "12px", padding: "4px 10px" }}
              >
                RDS Databases ({rdsCount})
              </button>
            )}
            {s3Count > 0 && (
              <button
                type="button"
                onClick={() => setTypeFilter("S3_BUCKET")}
                className={`tab-nav-btn ${typeFilter === "S3_BUCKET" ? "active" : ""}`}
                style={{ fontSize: "12px", padding: "4px 10px" }}
              >
                S3 Buckets ({s3Count})
              </button>
            )}
          </div>
        )}

        {/* Workload Content Area */}
        {loadingWorkloads ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--mid-warm-gray)" }}>
            <div style={{ fontSize: "20px", marginBottom: "8px" }}>⚡</div>
            <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--near-black-ink)" }}>
              Scanning AWS {connectedAccount?.region} across ECS, EC2, RDS, and S3...
            </div>
            <div style={{ fontSize: "12.5px", color: "var(--mid-warm-gray)", marginTop: "4px" }}>
              Executing bounded discovery queries via active temporary STS session.
            </div>
          </div>
        ) : !connectedAccount ? (
          /* Disconnected empty state */
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--mid-warm-gray)" }}>
            <p style={{ fontSize: "14px", marginBottom: "6px" }}>
              No workload services are currently registered or discovered.
            </p>
            <p style={{ fontSize: "12.5px", color: "var(--muted-gray)", maxWidth: "420px", margin: "0 auto" }}>
              Once a cloud provider is linked, discovered Fargate services, tasks, compute, and databases will automatically populate here.
            </p>
          </div>
        ) : !sessionActive ? (
          /* Session expired state notice */
          <div
            style={{
              padding: "24px 20px",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: "var(--radius-sm)",
              textAlign: "center"
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#92400e", marginBottom: "4px" }}>
              Temporary In-Memory Session Expired
            </div>
            <p style={{ fontSize: "13px", color: "#78350f", maxWidth: "500px", margin: "0 auto 16px auto", lineHeight: 1.5 }}>
              For strict security, AWS credentials live only in server memory and are never persisted to disk. Reconnect your session to discover real-time workloads.
            </p>
            <button
              type="button"
              onClick={() => setIsConnectModalOpen(true)}
              className="btn-primary"
              style={{ fontSize: "13px" }}
            >
              Reconnect AWS Session →
            </button>
          </div>
        ) : filteredWorkloads.length > 0 ? (
          /* Real Workloads Table */
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Resource / Workload</th>
                  <th>Category</th>
                  <th>Cluster / Placement</th>
                  <th>Status</th>
                  <th>Capacity / Sizing</th>
                  <th>Details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkloads.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <Link
                        href={`/infrastructure/${encodeURIComponent(w.name)}`}
                        style={{ fontWeight: 600, color: "var(--near-black-ink)", textDecoration: "underline" }}
                      >
                        {w.name}
                      </Link>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "11px",
                          fontFamily: "var(--font-mono)",
                          background: "#edece9",
                          padding: "2px 6px",
                          borderRadius: "3px"
                        }}
                      >
                        {w.type === "ECS_SERVICE"
                          ? (w.launchType || "ECS Fargate")
                          : w.type === "EC2_INSTANCE"
                          ? "EC2 Compute"
                          : w.type === "RDS_DATABASE"
                          ? "RDS Database"
                          : "S3 Bucket"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "13px", color: "var(--near-black-ink)", fontWeight: 500 }}>
                          {w.cluster || "Default Cluster"}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", fontFamily: "var(--font-mono)" }}>
                          {w.region}
                        </span>
                      </div>
                    </td>
                    <td>
                      {w.status === "PAUSED" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            background: "#fef3c7",
                            color: "#92400e",
                            border: "1px solid #fde68a",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "12px"
                          }}
                        >
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#d97706" }} />
                          PAUSED
                        </span>
                      ) : (
                        <span
                          className={`status-pill ${w.status === "HEALTHY" ? "connected" : "attention"}`}
                          style={{ fontSize: "11px" }}
                        >
                          <span className="status-dot-inner" />
                          {w.status}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: "13px" }}>
                      {w.type === "ECS_SERVICE"
                        ? w.status === "PAUSED"
                          ? "0 / 0 (Paused)"
                          : `${w.runningCount ?? 0} / ${w.desiredCount ?? 0} Running`
                        : w.type === "EC2_INSTANCE"
                        ? w.instanceType || "Instance"
                        : w.type === "RDS_DATABASE"
                        ? w.instanceType || "DB Cluster"
                        : "Object Store"}
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--mid-warm-gray)", fontFamily: "var(--font-mono)" }}>
                      {w.ipAddress || w.taskDefinition || "—"}
                    </td>
                    <td>
                      <Link
                        href={`/infrastructure/${encodeURIComponent(w.name)}`}
                        className="btn-secondary"
                        style={{ fontSize: "11.5px", padding: "4px 8px" }}
                      >
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* 0 Workloads Discovered in region */
          <div
            style={{
              textAlign: "center",
              padding: "36px 20px",
              background: "#fcfbf9",
              border: "1px dashed var(--warm-gray-border)",
              borderRadius: "var(--radius-sm)"
            }}
          >
            <div style={{ fontSize: "18px", marginBottom: "8px" }}>🔍</div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
              No Workloads Discovered in {connectedAccount.region}
            </div>
            <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", maxWidth: "520px", margin: "0 auto 16px auto", lineHeight: 1.5 }}>
              Connected to AWS Account <span className="mono">{connectedAccount.accountId}</span>. No active or paused ECS services, EC2 compute instances, or RDS databases were found in region <span className="mono">{connectedAccount.region}</span>.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
              <button
                type="button"
                onClick={() => loadAccountsAndWorkloads()}
                className="btn-secondary"
                style={{ fontSize: "13px" }}
              >
                ↻ Re-scan {connectedAccount.region}
              </button>
              <Link href="/cloud/connect" className="btn-primary" style={{ fontSize: "13px" }}>
                Switch Region / Settings
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Connection Modal */}
      <AwsConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onSuccess={() => loadAccountsAndWorkloads()}
        tenantId={tenantId}
        operatorId={operatorId}
      />
    </div>
  );
}
