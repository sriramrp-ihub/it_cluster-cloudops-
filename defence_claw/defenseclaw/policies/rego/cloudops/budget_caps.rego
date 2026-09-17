package cloudops.authz

import rego.v1

monthly_budget_usd := 500.00

default budget_exceeded := false

budget_exceeded if {
	estimated := estimate_cost(input.capability, input.arguments)
	estimated > monthly_budget_usd
	not input.budget_override
}

default estimate_cost(_, _) := 0.0

estimate_cost(cap, args) := cost if {
	cap in {"aws.ecs.deploy_service", "aws_ecs_deploy_service"}
	cpu := args.cpu
	memory := args.memory
	count := args.desired_count
	cost := calculate_fargate_cost(cpu, memory, count)
}

calculate_fargate_cost(cpu, memory, count) := cost if {
	vcpu := cpu / 1024.0
	gb := memory / 1024.0
	hourly := (vcpu * 0.04048) + (gb * 0.004445)
	cost := (hourly * 730.0) * count
}
