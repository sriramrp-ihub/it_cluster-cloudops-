package cloudops.authz

import rego.v1

# Capability tier definitions
deploy_tier := {
	"deploy",
	"deploy:*",
	"aws.ecs.deploy_service",
	"aws_ecs_deploy_service",
	"aws.ecs.register_task_definition",
	"aws_ecs_register_task_definition",
	"aws.ecs.rollback_service",
	"aws_ecs_rollback_service",
}

mutate_tier := {
	"mutate",
	"mutate:*",
	"aws.ecs.update_service",
	"aws_ecs_update_service",
	"aws.ecs.scale_service",
	"aws_ecs_scale_service",
}

read_tier := {
	"read",
	"read:*",
	"aws.ecs.describe_clusters",
	"aws_ecs_describe_clusters",
	"aws.ecs.describe_services",
	"aws_ecs_describe_services",
	"aws.ecs.list_tasks",
	"aws_ecs_list_tasks",
	"aws.cloudwatch.get_metric_data",
	"aws_cloudwatch_get_metric_data",
}

# Capability tier classification
capability_tier(cap) := "deploy" if cap in deploy_tier
capability_tier(cap) := "mutate" if cap in mutate_tier
capability_tier(cap) := "read" if cap in read_tier
default capability_tier(_) := "unknown"

# Granted tiers for agent
granted_tiers := [tier |
	some cap in input.granted_capabilities
	tier := capability_tier(cap)
]
