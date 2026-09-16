import React from "react";
import Link from "next/link";

export default function ServicesCatalogPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Header */}
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
              Inventory
            </span>
          </div>
          <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
            Cloud Infrastructure Services
          </h1>
          <p className="lead-text" style={{ fontSize: "15px" }}>
            Discovered compute, container, database, and storage resources managed across your connected cloud environments.
          </p>
        </div>

        <Link href="/cloud/connect" className="btn-primary">
          + Connect Cloud Provider
        </Link>
      </div>

      {/* Honest Empty State */}
      <div className="harvey-card" style={{ padding: "48px 24px", textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#edece9", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted-gray)" }}>
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </svg>
        </div>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", color: "var(--near-black-ink)", marginBottom: "8px", fontWeight: 400 }}>
          No Cloud Infrastructure Connected Yet
        </h2>
        <p className="body-subtle" style={{ maxWidth: "480px", margin: "0 auto 24px auto" }}>
          CloudOps discovers and catalogs infrastructure resources once an AWS, Google Cloud, or Azure provider account is connected.
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
          <Link href="/cloud/connect" className="btn-primary">
            Connect Cloud Account
          </Link>
          <Link href="/agents" className="btn-secondary">
            View Operational Agents
          </Link>
        </div>
      </div>

      {/* Supported Services Blueprint Grid */}
      <div>
        <h3 className="panel-title" style={{ marginBottom: "16px" }}>
          Supported Cloud Service Workloads
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
          <div className="harvey-card" style={{ padding: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>AWS ECS & Fargate</div>
            <p className="body-subtle" style={{ fontSize: "12.5px" }}>
              Container task lifecycles, service deployments, and task scaling events.
            </p>
          </div>

          <div className="harvey-card" style={{ padding: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>Kubernetes (EKS / GKE)</div>
            <p className="body-subtle" style={{ fontSize: "12.5px" }}>
              Pod health inspection, deployment rollouts, and crashloop diagnostics.
            </p>
          </div>

          <div className="harvey-card" style={{ padding: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>Relational Databases (RDS)</div>
            <p className="body-subtle" style={{ fontSize: "12.5px" }}>
              Connection pool saturation, replica lag, and failover health checks.
            </p>
          </div>

          <div className="harvey-card" style={{ padding: "16px" }}>
            <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>Object Storage (S3 / GCS)</div>
            <p className="body-subtle" style={{ fontSize: "12.5px" }}>
              Bucket policy verification, encryption posture, and lifecycle policies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
