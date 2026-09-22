// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package cloudops

import (
	"context"
	"strings"
	"time"

	"github.com/defenseclaw/defenseclaw/internal/gateway/opa"
	"github.com/defenseclaw/defenseclaw/internal/schemas"
)

// CloudOpsConnector implements HookConnector for CloudOps ACP gateway
type CloudOpsConnector struct {
	opaClient *opa.Client
	config    CloudOpsConfig
}

type CloudOpsConfig struct {
	PolicyBundlePath string
	OPAEndpoint      string
	TenantID         string
}

type CapabilityRequest struct {
	CorrelationID       string                 `json:"correlation_id"`
	AgentID             string                 `json:"agent_id"`
	TenantID            string                 `json:"tenant_id"`
	Capability          string                 `json:"capability"`
	Arguments           map[string]interface{} `json:"arguments"`
	GrantedCapabilities []string               `json:"granted_capabilities,omitempty"`
	Traceparent         string                 `json:"traceparent,omitempty"`
	ApprovalGranted     bool                   `json:"approval_granted,omitempty"`
	BudgetOverride      bool                   `json:"budget_override,omitempty"`
	ResourceTenant      string                 `json:"resource_tenant,omitempty"`
}

type CapabilityResponse struct {
	CorrelationID string                       `json:"correlation_id"`
	Allowed       bool                         `json:"allowed"`
	Verdict       string                       `json:"verdict"` // ALLOW, BLOCK, APPROVAL_REQUIRED
	Reason        string                       `json:"reason"`
	RuleID        string                       `json:"rule_id,omitempty"`
	AuditEvent    schemas.GatewayEventEnvelope `json:"audit_event"`
}

func New(config CloudOpsConfig) (*CloudOpsConnector, error) {
	opaClient, err := opa.NewClient(config.OPAEndpoint)
	if err != nil {
		return nil, err
	}

	// Load CloudOps Rego bundle
	if err := opaClient.LoadBundle(config.PolicyBundlePath); err != nil {
		return nil, err
	}

	return &CloudOpsConnector{
		opaClient: opaClient,
		config:    config,
	}, nil
}

func (c *CloudOpsConnector) EvaluateCapability(ctx context.Context, req CapabilityRequest) (*CapabilityResponse, error) {
	if req.Arguments == nil {
		req.Arguments = make(map[string]interface{})
	}

	resourceTenant := req.ResourceTenant
	if resourceTenant == "" && req.TenantID != "" {
		resourceTenant = req.TenantID
	}

	// Build OPA input
	input := map[string]interface{}{
		"agent_id":             req.AgentID,
		"tenant_id":            req.TenantID,
		"agent_tenant":         req.TenantID,
		"resource_tenant":      resourceTenant,
		"capability":           req.Capability,
		"arguments":            req.Arguments,
		"granted_capabilities": req.GrantedCapabilities,
		"traceparent":          req.Traceparent,
		"approval_granted":     req.ApprovalGranted,
		"budget_override":      req.BudgetOverride,
		"timestamp":            time.Now().UTC().Format(time.RFC3339),
	}

	// Query OPA: data.cloudops.authz.allow
	result, err := c.opaClient.Query(ctx, "data.cloudops.authz.allow", input)
	if err != nil {
		return nil, err
	}

	// Parse verdict
	allowed := false
	verdict := "BLOCK"
	reason := "Policy evaluation failed"
	ruleID := ""

	if result != nil {
		if resultBool, ok := result.(bool); ok {
			allowed = resultBool
			if allowed {
				verdict = "ALLOW"
				reason = "Authorized capability"
				ruleID = "ALLOW_READ_CAPABILITY"
			}
		}
		if resultMap, ok := result.(map[string]interface{}); ok {
			if v, ok := resultMap["verdict"].(string); ok && v != "" {
				verdict = v
			}
			if r, ok := resultMap["reason"].(string); ok && r != "" {
				reason = r
			}
			if id, ok := resultMap["rule_id"].(string); ok && id != "" {
				ruleID = id
			}
			if a, ok := resultMap["allow"].(bool); ok {
				allowed = a
			} else {
				allowed = (verdict == "ALLOW")
			}
		}
	}

	if ruleID == "" && verdict == "BLOCK" {
		ruleID = "UNCLASSIFIED_CAPABILITY_BLOCKED"
	}

	// Build v7 audit envelope
	auditEvent := schemas.GatewayEventEnvelope{
		TS:            time.Now().UTC().Format(time.RFC3339),
		EventType:     "hook_decision",
		Severity:      mapVerdictToSeverity(verdict),
		SchemaVersion: 7,
		AgentID:       req.AgentID,
		TenantID:      req.TenantID,
		TraceID:       extractTraceID(req.Traceparent),
		HookDecision: &schemas.HookDecisionPayload{
			Connector:  "cloudops",
			Event:      "CapabilityRequest",
			Result:     "ok",
			Action:     verdictToAction(verdict),
			RawAction:  verdictToAction(verdict),
			Severity:   mapVerdictToSeverity(verdict),
			Mode:       "enforcing",
			WouldBlock: !allowed,
			Enforced:   true,
			Reason:     reason,
			RuleIDs:    []string{ruleID},
		},
	}

	return &CapabilityResponse{
		CorrelationID: req.CorrelationID,
		Allowed:       allowed,
		Verdict:       verdict,
		Reason:        reason,
		RuleID:        ruleID,
		AuditEvent:    auditEvent,
	}, nil
}

func (c *CloudOpsConnector) ConnectorName() string {
	return "cloudops"
}

func (c *CloudOpsConnector) SupportedEvents() []string {
	return []string{"CapabilityRequest", "CapabilityResponse", "AuthRefresh", "ToolInvocation"}
}

func (c *CloudOpsConnector) Close() error {
	return c.opaClient.Close()
}

// Helper functions

func verdictToAction(v string) string {
	switch v {
	case "ALLOW":
		return "allow"
	case "BLOCK":
		return "block"
	case "APPROVAL_REQUIRED":
		return "confirm"
	default:
		return "block"
	}
}

func mapVerdictToSeverity(v string) string {
	switch v {
	case "ALLOW":
		return "INFO"
	case "APPROVAL_REQUIRED":
		return "WARN"
	case "BLOCK":
		return "HIGH"
	default:
		return "HIGH"
	}
}

func extractTraceID(traceparent string) string {
	// Parse W3C traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203301-01
	parts := strings.Split(traceparent, "-")
	if len(parts) >= 2 {
		return parts[1]
	}
	return ""
}
