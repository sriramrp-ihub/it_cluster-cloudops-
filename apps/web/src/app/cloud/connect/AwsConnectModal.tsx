"use client";

import React, { useState, useEffect, useRef } from "react";
import { createCloudAccount, CloudAccountItem } from "../../../lib/api";

interface AwsConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (account: CloudAccountItem) => void;
  tenantId: string;
  operatorId: string;
}

const REGION_OPTIONS = [
  { value: "us-east-1", label: "us-east-1 (N. Virginia)" },
  { value: "us-east-2", label: "us-east-2 (Ohio)" },
  { value: "us-west-1", label: "us-west-1 (N. California)" },
  { value: "us-west-2", label: "us-west-2 (Oregon)" },
  { value: "eu-north-1", label: "eu-north-1 (Stockholm)" },
  { value: "eu-west-1", label: "eu-west-1 (Ireland)" },
  { value: "eu-west-2", label: "eu-west-2 (London)" },
  { value: "eu-west-3", label: "eu-west-3 (Paris)" },
  { value: "eu-central-1", label: "eu-central-1 (Frankfurt)" },
  { value: "eu-south-1", label: "eu-south-1 (Milan)" },
  { value: "ap-northeast-1", label: "ap-northeast-1 (Tokyo)" },
  { value: "ap-southeast-1", label: "ap-southeast-1 (Singapore)" },
  { value: "ap-southeast-2", label: "ap-southeast-2 (Sydney)" },
  { value: "ap-south-1", label: "ap-south-1 (Mumbai)" },
  { value: "ca-central-1", label: "ca-central-1 (Canada)" },
  { value: "sa-east-1", label: "sa-east-1 (São Paulo)" }
];

export function AwsConnectModal({
  isOpen,
  onClose,
  onSuccess,
  tenantId,
  operatorId
}: AwsConnectModalProps) {
  const [region, setRegion] = useState("us-east-1");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [assumeRoleArn, setAssumeRoleArn] = useState("");

  const [status, setStatus] = useState<"IDLE" | "CONNECTING" | "CONNECTED" | "ERROR">("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectedResult, setConnectedResult] = useState<CloudAccountItem | null>(null);

  const initialInputRef = useRef<HTMLInputElement>(null);

  // Focus trap & Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "CONNECTING") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Autofocus first interactive input when modal opens
    const timer = setTimeout(() => {
      initialInputRef.current?.focus();
    }, 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, status]);

  // Clean sensitive state whenever modal closes
  const handleClose = () => {
    if (status === "CONNECTING") return;
    setAccessKeyId("");
    setSecretAccessKey("");
    setSessionToken("");
    setAssumeRoleArn("");
    setStatus("IDLE");
    setErrorMessage(null);
    setConnectedResult(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "CONNECTING") return;

    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      setStatus("ERROR");
      setErrorMessage("Please provide both AWS Access Key ID and Secret Access Key.");
      return;
    }

    setStatus("CONNECTING");
    setErrorMessage(null);

    try {
      const result = await createCloudAccount(
        {
          provider: "aws",
          region,
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          sessionToken: sessionToken.trim() || undefined,
          assumeRoleArn: assumeRoleArn.trim() || undefined
        },
        tenantId,
        operatorId
      );

      // Immediately clear raw credential state from memory
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
      setAssumeRoleArn("");

      setStatus("CONNECTED");
      setConnectedResult(result);
      onSuccess(result);

      // Auto-dismiss modal after showing success confirmation
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err: any) {
      setStatus("ERROR");
      setErrorMessage(err.message || "Failed to authenticate AWS credentials.");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aws-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(22, 22, 22, 0.65)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "1rem"
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== "CONNECTING") {
          handleClose();
        }
      }}
    >
      <div
        className="harvey-card"
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor: "#ffffff",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1)",
          padding: "24px",
          borderRadius: "var(--radius-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "18px"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2
              id="aws-modal-title"
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--near-black-ink)",
                margin: 0
              }}
            >
              Connect AWS Account
            </h2>
            <div
              style={{
                fontSize: "12px",
                color: "var(--mid-warm-gray)",
                marginTop: "2px",
                fontFamily: "var(--font-mono)"
              }}
            >
              Temporary In-Memory Session Authentication
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={status === "CONNECTING"}
            aria-label="Close modal"
            style={{
              background: "transparent",
              border: "none",
              fontSize: "18px",
              cursor: status === "CONNECTING" ? "not-allowed" : "pointer",
              color: "var(--mid-warm-gray)",
              padding: "4px 8px"
            }}
          >
            ✕
          </button>
        </div>

        {/* Security Notice */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "12px 14px",
            background: "#f4f3ef",
            border: "1px solid var(--warm-gray-border)",
            borderRadius: "var(--radius-sm)"
          }}
        >
          <div style={{ fontSize: "16px", marginTop: "1px" }}>🛡️</div>
          <div style={{ fontSize: "12px", color: "var(--near-black-ink)", lineHeight: 1.45 }}>
            Credentials are used strictly in-memory by the backend to establish a temporary STS session and are never stored in your browser or local storage.
          </div>
        </div>

        {/* Success State View */}
        {status === "CONNECTED" && connectedResult && (
          <div
            style={{
              padding: "16px",
              background: "#eef8f1",
              border: "1px solid #c2e5cc",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#166534", fontWeight: 600 }}>
              <span>✓</span>
              <span>AWS Account Connected Successfully</span>
            </div>
            <div style={{ fontSize: "13px", color: "var(--near-black-ink)" }}>
              <div><strong>Account:</strong> <span className="mono">{connectedResult.accountId}</span></div>
              <div><strong>Region:</strong> <span className="mono">{connectedResult.region}</span></div>
              {connectedResult.roleArn && (
                <div><strong>Assumed Role:</strong> <span className="mono">{connectedResult.roleArn}</span></div>
              )}
              <div><strong>Status:</strong> <span style={{ color: "#166534", fontWeight: 600 }}>Connected</span></div>
            </div>
          </div>
        )}

        {/* Error Notification */}
        {status === "ERROR" && errorMessage && (
          <div
            style={{
              padding: "12px 14px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "var(--radius-sm)",
              color: "#991b1b",
              fontSize: "13px",
              lineHeight: 1.4
            }}
          >
            <strong>Error:</strong> {errorMessage}
          </div>
        )}

        {/* Form */}
        {status !== "CONNECTED" && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: "12px", fontWeight: 600 }}>
                AWS Region <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={status === "CONNECTING"}
                className="form-input"
                style={{ width: "100%" }}
              >
                {REGION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontSize: "12px", fontWeight: 600 }}>
                AWS Access Key ID <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <input
                ref={initialInputRef}
                type="text"
                placeholder="AKIAIOSFODNN7EXAMPLE"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                disabled={status === "CONNECTING"}
                className="form-input mono"
                required
                autoComplete="off"
                spellCheck="false"
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontSize: "12px", fontWeight: 600 }}>
                AWS Secret Access Key <span style={{ color: "#b91c1c" }}>*</span>
              </label>
              <input
                type="password"
                placeholder="••••••••••••••••••••••••••••••••"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                disabled={status === "CONNECTING"}
                className="form-input mono"
                required
                autoComplete="new-password"
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontSize: "12px", fontWeight: 600 }}>
                AWS Session Token <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", fontWeight: 400 }}>(Optional - for temporary AWS credentials)</span>
              </label>
              <input
                type="password"
                placeholder="Optional session token"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                disabled={status === "CONNECTING"}
                className="form-input mono"
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontSize: "12px", fontWeight: 600 }}>
                Assume Role ARN <span style={{ fontSize: "11px", color: "var(--mid-warm-gray)", fontWeight: 400 }}>(Optional - cross-account delegation)</span>
              </label>
              <input
                type="text"
                placeholder="arn:aws:iam::123456789012:role/CloudOpsRole"
                value={assumeRoleArn}
                onChange={(e) => setAssumeRoleArn(e.target.value)}
                disabled={status === "CONNECTING"}
                className="form-input mono"
                autoComplete="off"
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={handleClose}
                disabled={status === "CONNECTING"}
                className="btn-secondary"
                style={{ padding: "8px 16px" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={status === "CONNECTING"}
                className="btn-primary"
                style={{ padding: "8px 18px", minWidth: "130px" }}
              >
                {status === "CONNECTING" ? "Connecting..." : "Connect AWS"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
