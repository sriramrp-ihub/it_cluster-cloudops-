package cloudops.authz

import rego.v1

allowed_regions := {"us-east-1", "us-west-2", "eu-west-1", "eu-north-1"}

default region_allowed := false

region_allowed if {
	not input.arguments.region
}

region_allowed if {
	input.arguments.region in allowed_regions
}
