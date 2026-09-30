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
	"aws.ecs.enable_cloudwatch_logging",
	"aws_ecs_enable_cloudwatch_logging",
	# Irreversible deletions are classified at the SAME elevated tier as
	# deploy — a plain "mutate" grant (e.g. scale/restart) must never be
	# sufficient to permanently delete a service, cluster, or task
	# definition revision.
	"aws.ecs.delete_service",
	"aws_ecs_delete_service",
	"aws.ecs.delete_cluster",
	"aws_ecs_delete_cluster",
	"aws.ecs.deregister_task_definition",
	"aws_ecs_deregister_task_definition",
}

mutate_tier := {
	"mutate",
	"mutate:*",
	"aws.ecs.update_service",
	"aws_ecs_update_service",
	"aws.ecs.update_service_image",
	"aws_ecs_update_service_image",
	"aws.ecs.scale_service",
	"aws_ecs_scale_service",
	"aws.ec2.reboot_instances",
	"aws_ec2_reboot_instances",
	"aws.ec2.stop_instances",
	"aws_ec2_stop_instances",
	"aws.ec2.start_instances",
	"aws_ec2_start_instances",
	"aws.rds.reboot_db_instance",
	"aws_rds_reboot_db_instance",
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
	"aws.ecs.describe_stopped_tasks",
	"aws_ecs_describe_stopped_tasks",
	"aws.ecs.describe_tasks",
	"aws_ecs_describe_tasks",
	"aws.alb.get_target_health",
	"aws_alb_get_target_health",
	"aws.ecr.describe_images",
	"aws_ecr_describe_images",
	"aws.s3.list_buckets",
	"aws_s3_list_buckets",
	"aws.s3.list_objects",
	"aws_s3_list_objects",
	"aws.ec2.describe_instances",
	"aws_ec2_describe_instances",
	"aws.rds.describe_db_instances",
	"aws_rds_describe_db_instances",
	"aws.s3.create_upload_url",
	"aws_s3_create_upload_url",
	"aws.s3.create_download_url",
	"aws_s3_create_download_url",
	"aws.ec2.describe_security_groups",
	"aws_ec2_describe_security_groups",
	"aws.ec2.describe_volumes",
	"aws_ec2_describe_volumes",
	"aws.logs.describe_log_groups",
	"aws_logs_describe_log_groups",
	"aws.logs.filter_log_events",
	"aws_logs_filter_log_events",
	"aws.ecs.list_clusters",
	"aws_ecs_list_clusters",
	"aws.ecs.list_services",
	"aws_ecs_list_services",
	"aws.ecs.list_task_definitions",
	"aws_ecs_list_task_definition_revisions",
	"aws.ecs.describe_capacity_providers",
	"aws_ecs_describe_capacity_providers",
	"aws.ecs.describe_autoscaling",
	"aws_ecs_describe_autoscaling",
	"aws.ecs.describe_task_definition_config",
	"aws_ecs_describe_task_definition_config",
	# Phase 3.1: the chat surface's own read-only "converse" operation.
	# Classified read-tier deliberately — answering an operator's question
	# never mutates infrastructure. Any cloud action the response proposes is
	# a *separate* capability, evaluated independently through this same
	# policy engine before it can execute — this entry only covers the
	# conversational turn itself.
	"operator_chat_query",
}

# Capability tier classification
capability_tier(cap) := "deploy" if cap in deploy_tier
capability_tier(cap) := "mutate" if cap in mutate_tier
capability_tier(cap) := "read" if cap in read_tier
# Fail-Closed Tier Policy:
# Any capability not explicitly listed in deploy_tier, mutate_tier, or read_tier
# defaults to tier "unknown".
# In main.rego, capabilities with tier "unknown" are BLOCKED (verdict: BLOCK,
# rule_id: UNCLASSIFIED_CAPABILITY_BLOCKED) even if approval_granted is true.
#
# This fail-closed design guarantees that destructive actions (e.g.
# aws_ec2_terminate_instances, aws_rds_delete_db_instance, aws_s3_delete_bucket,
# aws_ecs_delete_service, aws_ecs_delete_cluster, aws_ecs_deregister_task_definition)
# cannot be executed merely by passing an approval flag unless they have also been
# explicitly onboarded and classified into an authorized tier.
default capability_tier(_) := "unknown"

# Granted tiers for agent
granted_tiers := [tier |
	some cap in input.granted_capabilities
	tier := capability_tier(cap)
]
