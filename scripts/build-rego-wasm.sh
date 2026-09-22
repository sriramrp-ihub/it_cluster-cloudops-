#!/usr/bin/env bash
set -euo pipefail

# Determine repository root relative to script directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_WASM="$ROOT_DIR/packages/security/src/cloudops_policy.wasm"
PINNED_OPA_VERSION="1.15.2"

# Preflight check: Verify opa CLI exists
if ! command -v opa &>/dev/null; then
  echo "error: opa CLI not found. Install opa ${PINNED_OPA_VERSION} (https://www.openpolicyagent.org/docs/latest/#running-opa) before running this build." >&2
  exit 1
fi

# Preflight check: Verify opa version matches pinned version
OPA_VERSION_OUTPUT="$(opa version 2>/dev/null || true)"
OPA_INSTALLED_VERSION="$(echo "$OPA_VERSION_OUTPUT" | grep -E "^Version:" | head -n 1 | awk '{print $2}')"

if [ -z "$OPA_INSTALLED_VERSION" ]; then
  echo "warning: Unable to determine opa version from 'opa version'. Proceeding with build." >&2
elif [ "$OPA_INSTALLED_VERSION" != "$PINNED_OPA_VERSION" ]; then
  echo "warning: opa CLI version ($OPA_INSTALLED_VERSION) does not match pinned version ($PINNED_OPA_VERSION). Build will proceed, but version drift may affect parity." >&2
else
  echo "opa CLI preflight check passed: version $OPA_INSTALLED_VERSION"
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Compiling CloudOps Rego policy bundle to WebAssembly..."
opa build -t wasm \
  -e cloudops/authz/allow \
  -e cloudops/authz/verdict \
  -e cloudops/authz/rule_id \
  -e cloudops/authz/reason \
  "$ROOT_DIR/defence_claw/defenseclaw/policies/rego/cloudops/" \
  -o "$TMP_DIR/bundle.tar.gz"

tar -xzf "$TMP_DIR/bundle.tar.gz" -C "$TMP_DIR"

if [ ! -f "$TMP_DIR/policy.wasm" ]; then
  echo "error: Compiled policy.wasm not found in OPA build bundle archive" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_WASM")"
cp "$TMP_DIR/policy.wasm" "$TARGET_WASM"

DIST_DIR="$ROOT_DIR/packages/security/dist"
if [ -d "$DIST_DIR" ]; then
  cp "$TMP_DIR/policy.wasm" "$DIST_DIR/cloudops_policy.wasm"
fi

echo "WASM build successful: $TARGET_WASM ($(ls -lh "$TARGET_WASM" | awk '{print $5}'))"
