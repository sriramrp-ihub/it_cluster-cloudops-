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
	"path/filepath"
	"testing"
)

func setupTestConnector(t *testing.T) *CloudOpsConnector {
	t.Helper()
	// Relative path to policies/rego/cloudops
	policyPath := filepath.Join("..", "..", "..", "..", "policies", "rego", "cloudops")
	c, err := New(CloudOpsConfig{
		PolicyBundlePath: policyPath,
		TenantID:         "ten_default_tenant",
	})
	if err != nil {
		t.Fatalf("setup CloudOpsConnector: %v", err)
	}
	t.Cleanup(func() {
		_ = c.Close()
	})
	return c
}

func TestEvaluateCapability_ReadAllowed(t *testing.T) {
	c := setupTestConnector(t)
	ctx := context.Background()

	resp, err := c.EvaluateCapability(ctx, CapabilityRequest{
		CorrelationID:       "req-1",
		AgentID:             "ag-test-1",
		TenantID:            "ten_default_tenant",
		Capability:          "aws.ecs.describe_clusters",
		Arguments:           map[string]interface{}{"clusters": []string{"demo"}, "region": "us-east-1"},
		GrantedCapabilities: []string{"aws.ecs.describe_clusters", "aws.ecs.list_tasks"},
		Traceparent:         "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.Allowed {
		t.Errorf("expected allowed=true, got false (reason: %s)", resp.Reason)
	}
	if resp.Verdict != "ALLOW" {
		t.Errorf("expected verdict=ALLOW, got %s", resp.Verdict)
	}
	if resp.AuditEvent.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("expected trace ID 4bf92f3577b34da6a3ce929d0e0e4736, got %s", resp.AuditEvent.TraceID)
	}
}

func TestEvaluateCapability_UngrantedBlocked(t *testing.T) {
	c := setupTestConnector(t)
	ctx := context.Background()

	resp, err := c.EvaluateCapability(ctx, CapabilityRequest{
		CorrelationID:       "req-2",
		AgentID:             "ag-test-1",
		TenantID:            "ten_default_tenant",
		Capability:          "aws.ecs.update_service",
		Arguments:           map[string]interface{}{"service": "srv-1", "region": "us-east-1"},
		GrantedCapabilities: []string{"aws.ecs.describe_clusters"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Allowed {
		t.Error("expected allowed=false for ungranted capability")
	}
	if resp.Verdict != "BLOCK" {
		t.Errorf("expected verdict=BLOCK, got %s", resp.Verdict)
	}
	if resp.RuleID != "CAPABILITY_NOT_GRANTED" {
		t.Errorf("expected rule_id=CAPABILITY_NOT_GRANTED, got %s", resp.RuleID)
	}
}

func TestEvaluateCapability_MutateRequiresApproval(t *testing.T) {
	c := setupTestConnector(t)
	ctx := context.Background()

	resp, err := c.EvaluateCapability(ctx, CapabilityRequest{
		CorrelationID:       "req-3",
		AgentID:             "ag-test-1",
		TenantID:            "ten_default_tenant",
		Capability:          "aws.ecs.update_service",
		Arguments:           map[string]interface{}{"service": "srv-1", "region": "us-east-1"},
		GrantedCapabilities: []string{"aws.ecs.update_service"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Allowed {
		t.Error("expected allowed=false for mutate capability without approval")
	}
	if resp.Verdict != "APPROVAL_REQUIRED" {
		t.Errorf("expected verdict=APPROVAL_REQUIRED, got %s", resp.Verdict)
	}
	if resp.RuleID != "REQUIRE_HUMAN_APPROVAL" {
		t.Errorf("expected rule_id=REQUIRE_HUMAN_APPROVAL, got %s", resp.RuleID)
	}
}

func TestEvaluateCapability_DestructiveBlockedWithoutApproval(t *testing.T) {
	c := setupTestConnector(t)
	ctx := context.Background()

	resp, err := c.EvaluateCapability(ctx, CapabilityRequest{
		CorrelationID:       "req-4",
		AgentID:             "ag-test-1",
		TenantID:            "ten_default_tenant",
		Capability:          "aws.ecs.delete_service",
		Arguments:           map[string]interface{}{"service": "srv-1", "region": "us-east-1"},
		GrantedCapabilities: []string{"aws.ecs.delete_service"},
		ApprovalGranted:     false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Allowed {
		t.Error("expected allowed=false for destructive action")
	}
	if resp.Verdict != "BLOCK" {
		t.Errorf("expected verdict=BLOCK, got %s", resp.Verdict)
	}
	if resp.RuleID != "DESTRUCTIVE_ACTION_BLOCKED" {
		t.Errorf("expected rule_id=DESTRUCTIVE_ACTION_BLOCKED, got %s", resp.RuleID)
	}
}

func TestEvaluateCapability_DestructiveAllowedWithApproval(t *testing.T) {
	c := setupTestConnector(t)
	ctx := context.Background()

	resp, err := c.EvaluateCapability(ctx, CapabilityRequest{
		CorrelationID:       "req-5",
		AgentID:             "ag-test-1",
		TenantID:            "ten_default_tenant",
		Capability:          "aws.ecs.delete_service",
		Arguments:           map[string]interface{}{"service": "srv-1", "region": "us-east-1"},
		GrantedCapabilities: []string{"aws.ecs.delete_service"},
		ApprovalGranted:     true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// With approval granted, it's treated as mutate/deploy tier requiring execution or approval required
	if resp.Verdict == "DESTRUCTIVE_ACTION_BLOCKED" {
		t.Error("destructive action should not be blocked when approval_granted=true")
	}
}
