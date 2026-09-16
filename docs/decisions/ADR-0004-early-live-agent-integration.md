# ADR-0004: Early Live Hermes Agent & AWS Integration (Pulling CO-107 Forward)

**Status:** Accepted  
**Date:** 2026-09-16  
**Related Backlog Items:** CO-001, CO-002, CO-004, CO-005, CO-006, CO-026, CO-028, CO-107 (Pulled Forward)

---

## Context

In the original CloudOps product backlog (`Cloudops-Product backlog.xlsx`), connecting a live LLM-driven autonomous agent runtime was scheduled for **Week 8 / Version V9** under **CO-107 ("Real Hermes Operational Turn")**. The rationale in Weeks 1–3 was to build and cryptographically verify all safety rails, policy enforcement gates (CO-018), human approval workflows (CO-019), and SHA-256 audit chaining (CO-012) against deterministic test fixtures first (ADR-0001).

However, during UI evaluation on `/infrastructure/starvision-motors`, an operator discrepancy was discovered: the prototype chat drawer was returning client-side simulated responses ("Nominal Operations — 95% Confidence") with hardcoded fallback numbers (`?? 1`, `42%`, `61%`). 

To establish absolute operational integrity, eliminate all synthetic and prototype scaffolding, and ground the control plane in genuine end-to-end reality, a deliberate architectural decision was made:
**Pull forward CO-107 to immediately follow the Part 1 governance audit, integrating live Hermes (`http://127.0.0.1:8080`) and real AWS account operations.**

---

## Roadmap Scope Consequences (Bypassed Items)

Pulling CO-107 forward directly after Week 3 means the system transitions to live agent operations **before** multi-cloud and enterprise hardening layers are implemented.

### **Technically Skipped / Deferred Backlog Milestones (Weeks 4–7):**
1. **Week 4 (V5 / CO-029 → CO-045): Azure Cloud Provider Integration**
   - Azure Resource Manager (ARM) STS federated identity, Azure Monitor metrics, and AKS container adapters remain unbuilt.
2. **Week 5 (V6 / CO-046 → CO-060): Google Cloud Platform (GCP) Provider Integration**
   - GCP Workload Identity Federation, Cloud Logging/Monitoring, and GKE cluster adapters remain unbuilt.
3. **Week 6 (V7 / CO-061 → CO-080): Enterprise Multi-Tenancy & Identity Hardening**
   - Enterprise SAML/OIDC SSO, fine-grained RBAC roles, and per-tenant cryptographic key isolation remain unbuilt.
4. **Week 7 (V8 / CO-081 → CO-106): Production Kubernetes & Edge Mesh Hardening**
   - Native K8s operator, eBPF network filtering, and multi-region failover remain unbuilt.

Anyone tracking the original roadmap must understand that CloudOps is now **live with AWS and Hermes on the Weeks 1–3 governance architecture**, rather than having completed the intermediate cloud providers.

---

## Architecture & Interface Invariant

The `HermesAgentAdapter` conforms strictly to the `AgentAdapter` interface established in CO-002:
```typescript
export interface AgentAdapter {
  readonly adapterType: string;
  readonly protocol: "acp" | "mcp";
  start(context: AgentExecutionContext): Promise<AgentSession>;
  onEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  onToolCall(sessionId: string, callback: (call: AgentToolCall) => Promise<AgentToolResult>): () => void;
  terminate(sessionId: string, reason: string): Promise<void>;
  getSession(sessionId: string): AgentSession | undefined;
}
```

### **Zero Gateway / Policy Alterations:**
No special cases for Hermes are introduced into `@cloudops/gateway`, `@cloudops/policy`, or `@cloudops/approvals`. Hermes communicates via normalized ACP/MCP event shapes, ensuring that switching between `MockAgentAdapter` and `HermesAgentAdapter` is a transparent runtime configuration.
