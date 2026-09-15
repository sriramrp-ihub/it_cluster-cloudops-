"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useAgentChat } from "../../../context/AgentChatContext";

export default function ServiceDetailPage({ params }: { params: Promise<{ serviceId: string }> }) {
  const resolvedParams = use(params);
  const serviceId = decodeURIComponent(resolvedParams.serviceId);

  const { setChatContext, openChat } = useAgentChat();
  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "logs" | "metrics" | "config" | "tasks">("overview");

  useEffect(() => {
    setChatContext({
      service: serviceId,
      environment: "Production",
      region: "us-east-1",
      sourcePage: `Service: ${serviceId}`
    });
  }, [serviceId, setChatContext]);

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
          ← Back to Services
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
              <span className="status-pill connected" style={{ fontSize: "11px" }}>
                <span className="status-dot-inner" />
                HEALTHY
              </span>
            </div>
            <div style={{ fontSize: "13px", color: "var(--mid-warm-gray)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Production</span>
              <span>•</span>
              <span>AWS ECS Fargate</span>
              <span>•</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>us-east-1</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => openChat(`Investigate ${serviceId}`)}
              className="btn-primary"
              style={{ fontSize: "13px" }}
            >
              Investigate {serviceId} →
            </button>
          </div>
        </div>
      </div>

      {/* 3. Progressive Disclosure Tabs */}
      <div className="tab-navigation-bar">
        {(["overview", "activity", "logs", "metrics", "config", "tasks"] as const).map((tabKey) => (
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
          {/* Quick Metrics Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
            <div className="harvey-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                Running Tasks
              </div>
              <div style={{ fontSize: "24px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
                3 / 3
              </div>
              <div style={{ fontSize: "12px", color: "#16a34a", marginTop: "2px" }}>100% Desired capacity</div>
            </div>

            <div className="harvey-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                CPU Utilization
              </div>
              <div style={{ fontSize: "24px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
                42%
              </div>
              <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>Threshold: 80%</div>
            </div>

            <div className="harvey-card" style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--mid-warm-gray)", textTransform: "uppercase" }}>
                Memory Utilization
              </div>
              <div style={{ fontSize: "24px", fontWeight: 600, color: "var(--near-black-ink)", marginTop: "4px" }}>
                61%
              </div>
              <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "2px" }}>Normal range</div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="harvey-card" style={{ padding: "20px 24px" }}>
            <h3 className="panel-title" style={{ marginBottom: "14px" }}>Recent Activity</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "var(--muted-gray)" }}>10:42</span>
                <span style={{ color: "#16a34a" }}>●</span>
                <span>Deployment completed successfully</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "var(--muted-gray)" }}>10:30</span>
                <span style={{ color: "var(--near-black-ink)" }}>●</span>
                <span>New task definition revision activated</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "var(--muted-gray)" }}>10:15</span>
                <span style={{ color: "#16a34a" }}>●</span>
                <span>Container health check passed</span>
              </div>
            </div>
          </div>

          {/* CloudOps Agent Quick Operational Actions */}
          <div className="harvey-card" style={{ padding: "20px 24px", background: "#fcfbf9" }}>
            <h3 className="panel-title" style={{ marginBottom: "6px" }}>CloudOps Agent Operational Actions</h3>
            <p className="body-subtle" style={{ marginBottom: "14px", fontSize: "13px" }}>
              Dispatch autonomous operational checks for {serviceId}.
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => openChat(`Investigate ${serviceId}`)}
                className="btn-secondary"
                style={{ fontSize: "13px" }}
              >
                🔍 Investigate {serviceId}
              </button>
              <button
                type="button"
                onClick={() => openChat(`Check deployment readiness for ${serviceId}`)}
                className="btn-secondary"
                style={{ fontSize: "13px" }}
              >
                📋 Check Deployment Readiness
              </button>
              <button
                type="button"
                onClick={() => openChat(`Analyze recent activity for ${serviceId}`)}
                className="btn-secondary"
                style={{ fontSize: "13px" }}
              >
                📈 Analyze Recent Activity
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "activity" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <h3 className="panel-title" style={{ marginBottom: "12px" }}>Detailed Event Stream</h3>
          <p className="body-subtle" style={{ fontSize: "13px", marginBottom: "16px" }}>
            Operational lifecycle events, scaling triggers, and health checks for {serviceId}.
          </p>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px", color: "var(--mid-warm-gray)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>[10:42:01 UTC] Service deployment transitioned to COMPLETED. Steady state reached.</div>
            <div>[10:30:14 UTC] Target group registered container instance i-03482a (healthy).</div>
            <div>[10:15:00 UTC] Route53 DNS health probe returned 200 OK.</div>
          </div>
        </div>
      )}

      {activeTab === "logs" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <h3 className="panel-title" style={{ marginBottom: "12px" }}>Container Log Streams</h3>
          <p className="body-subtle" style={{ fontSize: "13px", marginBottom: "16px" }}>
            Live stdout/stderr stream from AWS CloudWatch logs (<code className="code-inline">/aws/ecs/{serviceId}</code>).
          </p>
          <pre
            style={{
              background: "#0f0e0d",
              color: "#f5f5f4",
              padding: "16px",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              lineHeight: 1.6,
              overflowX: "auto"
            }}
          >
            {`[INFO] 2026-09-07T10:42:05Z Server listening on port 8080
[INFO] 2026-09-07T10:42:06Z Database pool initialized (min: 5, max: 20)
[INFO] 2026-09-07T10:42:15Z GET /healthz 200 OK (0.8ms)
[INFO] 2026-09-07T10:42:30Z Ingested operational telemetry batch #104`}
          </pre>
        </div>
      )}

      {activeTab === "metrics" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <h3 className="panel-title" style={{ marginBottom: "12px" }}>Workload Telemetry</h3>
          <p className="body-subtle" style={{ fontSize: "13px", marginBottom: "16px" }}>
            CloudWatch CPU, memory, and network throughput timeseries.
          </p>
          <div style={{ padding: "32px", textAlign: "center", background: "#fcfbf9", border: "1px dashed var(--warm-gray-border)", borderRadius: "var(--radius-sm)" }}>
            <p style={{ fontSize: "13.5px", color: "var(--near-black-ink)", fontWeight: 500 }}>
              Telemetry Streaming Active
            </p>
            <p style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginTop: "4px" }}>
              Sample interval: 1 minute. P95 latency: 42ms. 5xx rate: 0.00%.
            </p>
          </div>
        </div>
      )}

      {activeTab === "config" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <h3 className="panel-title" style={{ marginBottom: "12px" }}>Task Configuration</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--mid-warm-gray)" }}>Launch Type:</span>
              <span className="code-inline">FARGATE</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--mid-warm-gray)" }}>Task CPU / Memory:</span>
              <span className="code-inline">1024 / 2048 MB</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ color: "var(--mid-warm-gray)" }}>IAM Execution Role:</span>
              <span className="code-inline">arn:aws:iam::account:role/ecsTaskExecutionRole</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === "tasks" && (
        <div className="harvey-card" style={{ padding: "24px" }}>
          <h3 className="panel-title" style={{ marginBottom: "12px" }}>Active Task Replicas</h3>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task ID</th>
                  <th>Status</th>
                  <th>Availability Zone</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="code-inline">task-7fa8b9c1</span></td>
                  <td><span className="status-pill connected">RUNNING</span></td>
                  <td>us-east-1a</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>10.0.12.44</td>
                </tr>
                <tr>
                  <td><span className="code-inline">task-9de4c2a3</span></td>
                  <td><span className="status-pill connected">RUNNING</span></td>
                  <td>us-east-1b</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>10.0.18.91</td>
                </tr>
                <tr>
                  <td><span className="code-inline">task-11b0e5f7</span></td>
                  <td><span className="status-pill connected">RUNNING</span></td>
                  <td>us-east-1c</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>10.0.22.105</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
