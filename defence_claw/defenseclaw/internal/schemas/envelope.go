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

package schemas

// GatewayEventEnvelope represents a v7 Gateway event envelope for audit and telemetry.
type GatewayEventEnvelope struct {
	TS            string               `json:"ts"`
	EventType     string               `json:"event_type"`
	Severity      string               `json:"severity"`
	SchemaVersion int                  `json:"schema_version"`
	AgentID       string               `json:"agent_id"`
	TenantID      string               `json:"tenant_id"`
	TraceID       string               `json:"trace_id"`
	HookDecision  *HookDecisionPayload `json:"hook_decision,omitempty"`
}

// HookDecisionPayload captures the verdict of a hook decision.
type HookDecisionPayload struct {
	Connector  string   `json:"connector"`
	Event      string   `json:"event"`
	Result     string   `json:"result"`
	Action     string   `json:"action"`
	RawAction  string   `json:"raw_action"`
	Severity   string   `json:"severity"`
	Mode       string   `json:"mode"`
	WouldBlock bool     `json:"would_block"`
	Enforced   bool     `json:"enforced"`
	Reason     string   `json:"reason,omitempty"`
	RuleIDs    []string `json:"rule_ids,omitempty"`
}
