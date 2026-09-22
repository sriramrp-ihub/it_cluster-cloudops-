package cloudops.authz

import rego.v1

default allow := false
default verdict := "BLOCK"
default reason := "Policy evaluation failed"
default rule_id := ""

# ALLOW: Read-only capabilities within granted scope
allow if {
	capability_tier(input.capability) == "read"
	input.capability in input.granted_capabilities
	region_allowed
	tenant_isolated
	not budget_exceeded
	not destructive_blocked
}

# ALLOW: Mutate/Deploy capabilities with approval granted
allow if {
	capability_tier(input.capability) in {"mutate", "deploy"}
	input.capability in input.granted_capabilities
	input.approval_granted
	region_allowed
	tenant_isolated
	not budget_exceeded
	not destructive_blocked
}

verdict := "ALLOW" if {
	allow
}

reason := "Read-only capability within authorized scope" if {
	allow
	capability_tier(input.capability) == "read"
}

reason := "Authorized capability executed with approval" if {
	allow
	capability_tier(input.capability) in {"mutate", "deploy"}
}

rule_id := "ALLOW_READ_CAPABILITY" if {
	allow
	capability_tier(input.capability) == "read"
}

rule_id := "ALLOW_MUTATE_WITH_APPROVAL" if {
	allow
	capability_tier(input.capability) in {"mutate", "deploy"}
}

# APPROVAL_REQUIRED: Mutate/Deploy capabilities within granted scope without approval
verdict := "APPROVAL_REQUIRED" if {
	not allow
	capability_tier(input.capability) in {"mutate", "deploy"}
	input.capability in input.granted_capabilities
	not input.approval_granted
	region_allowed
	tenant_isolated
	not budget_exceeded
	not destructive_blocked
}

reason := "Mutating capability requires human approval" if {
	verdict == "APPROVAL_REQUIRED"
}

rule_id := "REQUIRE_HUMAN_APPROVAL" if {
	verdict == "APPROVAL_REQUIRED"
}

# BLOCK: Evaluates if not ALLOW and not APPROVAL_REQUIRED
# 1. Destructive action blocked
reason := sprintf("Destructive action '%s' requires explicit approval", [input.capability]) if {
	verdict == "BLOCK"
	destructive_blocked
}

rule_id := "DESTRUCTIVE_ACTION_BLOCKED" if {
	verdict == "BLOCK"
	destructive_blocked
}

# 2. Capability not granted
reason := sprintf("Capability '%s' not in granted scope", [input.capability]) if {
	verdict == "BLOCK"
	not destructive_blocked
	not input.capability in input.granted_capabilities
}

rule_id := "CAPABILITY_NOT_GRANTED" if {
	verdict == "BLOCK"
	not destructive_blocked
	not input.capability in input.granted_capabilities
}

# 3. Region not allowed
reason := sprintf("Region '%s' not in allowed regions", [input.arguments.region]) if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	not region_allowed
}

rule_id := "REGION_NOT_ALLOWED" if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	not region_allowed
}

# 4. Cross-tenant violation
reason := "Cross-tenant access denied" if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	region_allowed
	not tenant_isolated
}

rule_id := "TENANT_ISOLATION_VIOLATION" if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	region_allowed
	not tenant_isolated
}

# 5. Budget cap exceeded
reason := sprintf("Estimated cost $%.2f exceeds budget $%.2f", [estimate_cost(input.capability, input.arguments), monthly_budget_usd]) if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	region_allowed
	tenant_isolated
	budget_exceeded
}

rule_id := "BUDGET_CAP_EXCEEDED" if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	region_allowed
	tenant_isolated
	budget_exceeded
}

# 6. Unclassified capability blocked
reason := sprintf("Capability '%s' is not classified into an authorized tier", [input.capability]) if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	capability_tier(input.capability) == "unknown"
}

rule_id := "UNCLASSIFIED_CAPABILITY_BLOCKED" if {
	verdict == "BLOCK"
	not destructive_blocked
	input.capability in input.granted_capabilities
	capability_tier(input.capability) == "unknown"
}

