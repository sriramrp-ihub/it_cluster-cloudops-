# DefenseClaw Policy Bundle & OPA-WASM Toolchain

## Pinned Toolchain Version
- **OPA CLI Version:** `1.15.2` (pinned to match `defence_claw/defenseclaw/go.mod` dependency `github.com/open-policy-agent/opa v1.15.2`).
- **NPM SDK:** `@open-policy-agent/opa-wasm@1.10.0`.

## Rego Policy Source
The canonical Rego policies live at:
`defence_claw/defenseclaw/policies/rego/cloudops/`
- `main.rego` — Top-level authorization rules: `allow`, `verdict`, `rule_id`, and `reason`.
- `capability_tiers.rego` — Categorization into `read`, `mutate`, and `deploy`.
- `destructive_actions.rego` — High-risk destructive cloud operations requiring explicit approval.
- `budget_caps.rego` — Monthly cost thresholds and estimation.
- `region_allowlist.rego` — Permitted operational AWS regions.
- `tenant_isolation.rego` — Cross-tenant isolation boundaries.

## WebAssembly Compilation
The policy is compiled to WebAssembly at build time via `scripts/build-rego-wasm.sh`:
```bash
opa build -t wasm \
  -e cloudops/authz/allow \
  -e cloudops/authz/verdict \
  -e cloudops/authz/rule_id \
  -e cloudops/authz/reason \
  defence_claw/defenseclaw/policies/rego/cloudops/ \
  -o bundle.tar.gz

tar -xzf bundle.tar.gz policy.wasm
mv policy.wasm packages/security/src/cloudops_policy.wasm
```

The compiled WASM binary is generated dynamically at build time and is excluded from version control via `.gitignore`.
