package cloudops.authz

import rego.v1

destructive_actions := {
	"aws_ecs_delete_service",
	"aws.ecs.delete_service",
	"aws_ecs_delete_cluster",
	"aws.ecs.delete_cluster",
	"aws_ecs_deregister_task_definition",
	"aws.ecs.deregister_task_definition",
	"aws_rds_delete_db_instance",
	"aws.rds.delete_db_instance",
	"aws_ec2_terminate_instances",
	"aws.ec2.terminate_instances",
	"aws_s3_delete_bucket",
	"aws.s3.delete_bucket",
}

default destructive_blocked := false

destructive_blocked if {
	input.capability in destructive_actions
	not input.approval_granted
}
