"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useOperator } from "../../../auth/OperatorContext";
import { fetchCloudAccounts, deleteCloudAccount, CloudAccountItem } from "../../../lib/api";
import { AwsConnectModal } from "./AwsConnectModal";

export default function ConnectCloudPage() {
  const { session } = useOperator();
  const tenantId = session?.tenantId || "ten_default_tenant";
  const operatorId = session?.operatorId || "op_admin_operator";

  const [accounts, setAccounts] = useState<CloudAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAwsModalOpen, setIsAwsModalOpen] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await fetchCloudAccounts(tenantId, operatorId);
      setAccounts(list);
    } catch (err: any) {
      setError(err.message || "Failed to load cloud accounts");
    } finally {
      setLoading(false);
    }
  }, [tenantId, operatorId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleDisconnect = async (id: string) => {
    if (!window.confirm("Are you sure you want to disconnect this cloud account? The in-memory AWS session will be immediately invalidated.")) {
      return;
    }

    try {
      setDisconnectingId(id);
      await deleteCloudAccount(id, tenantId, operatorId);
      setAccounts((prev) => prev.filter((acc) => acc.id !== id));
    } catch (err: any) {
      alert(`Failed to disconnect: ${err.message}`);
    } finally {
      setDisconnectingId(null);
    }
  };

  const awsAccount = accounts.find((acc) => acc.provider.toLowerCase() === "aws" && acc.status === "CONNECTED");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", maxWidth: "920px", margin: "0 auto" }}>
      {/* Page Header */}
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
            Multi-Cloud
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)", fontFamily: "var(--font-mono)" }}>
            INFRASTRUCTURE INTEGRATION
          </span>
        </div>
        <h1 className="hero-title" style={{ fontSize: "36px", marginBottom: "0.25rem" }}>
          Connect Cloud Provider
        </h1>
        <p className="lead-text" style={{ fontSize: "15px" }}>
          Establish a secure identity link with your cloud infrastructure to discover services, inspect anomalies, and grant bounded operational capabilities.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "var(--radius-sm)",
            color: "#991b1b",
            fontSize: "13px"
          }}
        >
          {error}
        </div>
      )}

      {/* Connected AWS Account View (Section 28) */}
      {awsAccount ? (
        <div className="harvey-card" style={{ border: "1px solid #bbf7d0", background: "#fcfdfc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <h3 className="panel-title" style={{ fontSize: "20px", margin: 0 }}>
                  Amazon Web Services
                </h3>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    background: "#dcfce7",
                    color: "#15803d",
                    border: "1px solid #bbf7d0",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "12px"
                  }}
                >
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#16a34a" }} />
                  Connected
                </span>
              </div>
              <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", margin: 0 }}>
                Active in-memory STS session verified via GetCallerIdentity. Zero credentials stored in database.
              </p>
            </div>
            <span style={{ fontSize: "24px" }}>☁️</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
              padding: "16px",
              background: "#ffffff",
              border: "1px solid var(--warm-gray-border)",
              borderRadius: "var(--radius-sm)",
              marginBottom: "20px"
            }}
          >
            <div>
              <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "4px" }}>
                AWS Account ID
              </div>
              <div className="mono" style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                {awsAccount.accountId}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "4px" }}>
                Primary Region
              </div>
              <div className="mono" style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)" }}>
                {awsAccount.region}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "4px" }}>
                Assumed IAM Role
              </div>
              <div className="mono" style={{ fontSize: "13px", color: "var(--near-black-ink)", wordBreak: "break-all" }}>
                {awsAccount.roleArn || "Direct STS Caller Identity"}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--mid-warm-gray)", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: "4px" }}>
                Connected At
              </div>
              <div style={{ fontSize: "13px", color: "var(--near-black-ink)" }}>
                {new Date(awsAccount.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <Link href="/infrastructure" className="btn-primary" style={{ textDecoration: "none" }}>
              View Infrastructure
            </Link>
            <button
              type="button"
              onClick={() => setIsAwsModalOpen(true)}
              className="btn-secondary"
            >
              Connection Settings
            </button>
            <button
              type="button"
              onClick={() => handleDisconnect(awsAccount.id)}
              disabled={disconnectingId === awsAccount.id}
              className="btn-secondary"
              style={{ color: "#b91c1c", borderColor: "#fecaca" }}
            >
              {disconnectingId === awsAccount.id ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        </div>
      ) : (
        /* Provider Cards Grid (Section 1) */
        <div className="harvey-card">
          <h3 className="panel-title" style={{ marginBottom: "16px" }}>
            Choose Cloud Infrastructure Provider
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
            {/* AWS Card */}
            <div
              style={{
                padding: "20px",
                border: "1px solid var(--warm-gray-border)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                backgroundColor: "#ffffff"
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <h4 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--near-black-ink)" }}>
                    Amazon Web Services
                  </h4>
                  <span style={{ fontSize: "20px" }}>☁️</span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
                  ECS, EKS, RDS, S3, CloudWatch
                </div>
                <p style={{ fontSize: "13px", color: "var(--near-black-ink)", lineHeight: 1.45, marginBottom: "16px" }}>
                  Connect using temporary in-memory STS credentials. Supports cross-account IAM role assumption without persistent secret storage.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsAwsModalOpen(true)}
                className="btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
              >
                Connect AWS
              </button>
            </div>

            {/* Google Cloud Card (Section 29) */}
            <div
              style={{
                padding: "20px",
                border: "1px solid var(--warm-gray-border)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                backgroundColor: "#faf9f7",
                opacity: 0.85
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <h4 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--near-black-ink)" }}>
                    Google Cloud
                  </h4>
                  <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", background: "#edece9", padding: "2px 6px", borderRadius: "3px" }}>
                    Planned
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
                  GKE, Cloud Run, BigQuery
                </div>
                <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: 1.45, marginBottom: "16px" }}>
                  Real connection flow not implemented yet. Will support Workload Identity Federation without long-lived keys.
                </p>
              </div>

              <button
                type="button"
                disabled
                className="btn-secondary"
                style={{ width: "100%", justifyContent: "center", cursor: "not-allowed", opacity: 0.6 }}
              >
                Connect GCP (Coming Soon)
              </button>
            </div>

            {/* Microsoft Azure Card (Section 29) */}
            <div
              style={{
                padding: "20px",
                border: "1px solid var(--warm-gray-border)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                backgroundColor: "#faf9f7",
                opacity: 0.85
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <h4 style={{ fontSize: "17px", fontWeight: 700, margin: 0, color: "var(--near-black-ink)" }}>
                    Microsoft Azure
                  </h4>
                  <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", background: "#edece9", padding: "2px 6px", borderRadius: "3px" }}>
                    Planned
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--mid-warm-gray)", marginBottom: "12px" }}>
                  AKS, App Services, Cosmos
                </div>
                <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: 1.45, marginBottom: "16px" }}>
                  Real connection flow not implemented yet. Will support Azure Active Directory Workload Identity.
                </p>
              </div>

              <button
                type="button"
                disabled
                className="btn-secondary"
                style={{ width: "100%", justifyContent: "center", cursor: "not-allowed", opacity: 0.6 }}
              >
                Connect Azure (Coming Soon)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Architecture Guarantee Note */}
      <div
        style={{
          padding: "16px 20px",
          background: "#f4f3ef",
          border: "1px solid var(--warm-gray-border)",
          borderRadius: "var(--radius-sm)",
          display: "flex",
          gap: "14px",
          alignItems: "flex-start"
        }}
      >
        <span style={{ fontSize: "20px", marginTop: "2px" }}>🛡️</span>
        <div>
          <div style={{ fontWeight: 600, color: "var(--near-black-ink)", fontSize: "14px", marginBottom: "4px" }}>
            Zero Credential Persistence Security Boundary
          </div>
          <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)", lineHeight: 1.5, margin: 0 }}>
            CloudOps operates under a strict isolation model: Access Key IDs and Secret Access Keys are processed only in memory to validate identity with AWS STS. Only verified account metadata (Account ID, Region, Role ARN) is persisted to PostgreSQL. Secrets are never exposed to agents or stored in browser storage.
          </p>
        </div>
      </div>

      {/* AWS Connection Modal */}
      <AwsConnectModal
        isOpen={isAwsModalOpen}
        onClose={() => setIsAwsModalOpen(false)}
        onSuccess={() => loadAccounts()}
        tenantId={tenantId}
        operatorId={operatorId}
      />
    </div>
  );
}
