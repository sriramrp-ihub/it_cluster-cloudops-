package cloudops.authz

import rego.v1

default tenant_isolated := false

tenant_isolated if {
	input.agent_tenant == input.resource_tenant
}

tenant_isolated if {
	input.agent_tenant == "ten_admin" # Admin tenant can cross boundaries
}

tenant_isolated if {
	not input.resource_tenant
}
