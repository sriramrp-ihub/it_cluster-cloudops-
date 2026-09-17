#!/bin/bash
set -e

echo "=== Starting CloudOps Unified Container ==="

# 1. Ensure PostgreSQL user and bridge localhost to host.docker.internal when running in Docker
export PGUSER="${PGUSER:-postgres}"

if [ -n "$DATABASE_URL" ]; then
  # If DATABASE_URL lacks a username (no @), prepend postgres@
  if echo "$DATABASE_URL" | grep -qE '^postgres(ql)?://[^@]+:[0-9]+'; then
    export DATABASE_URL=$(echo "$DATABASE_URL" | sed -E 's#^(postgres(ql)?://)#\1postgres@#')
  fi
  # If DATABASE_URL points to localhost or 127.0.0.1, swap for host.docker.internal
  export DATABASE_URL=$(echo "$DATABASE_URL" | sed -E 's/([@\/])localhost:/\1host.docker.internal:/g' | sed -E 's/([@\/])127\.0\.0\.1:/\1host.docker.internal:/g')
  echo "[CloudOps Entrypoint] DATABASE_URL target: $(echo "$DATABASE_URL" | sed -E 's/:[^:@]+@/:***@/')"
fi

if [ -n "$HERMES_URL" ]; then
  export HERMES_URL=$(echo "$HERMES_URL" | sed -E 's/([@\/])localhost:/\1host.docker.internal:/g' | sed -E 's/([@\/])127\.0\.0\.1:/\1host.docker.internal:/g')
  echo "[CloudOps Entrypoint] HERMES_URL target: $HERMES_URL"
fi

if [ -n "$DEFENSECLAW_ENDPOINT" ]; then
  export DEFENSECLAW_ENDPOINT=$(echo "$DEFENSECLAW_ENDPOINT" | sed -E 's/([@\/])localhost:/\1host.docker.internal:/g' | sed -E 's/([@\/])127\.0\.0\.1:/\1host.docker.internal:/g')
  echo "[CloudOps Entrypoint] DEFENSECLAW_ENDPOINT target: $DEFENSECLAW_ENDPOINT"
fi

# Ensure API_HOST binds to 0.0.0.0 for container networking
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-3000}"
export PORT="${PORT:-3001}"
export NODE_ENV="${NODE_ENV:-production}"

# Run DB migration if database is available and DATABASE_URL is set
if [ -f "database/src/migrate.ts" ] && [ -n "$DATABASE_URL" ]; then
  echo "[CloudOps Entrypoint] Running database migrations..."
  npx tsx database/src/migrate.ts || echo "[CloudOps Entrypoint] Note: Migration skipped or database connecting."
fi

# 2. Launch Fastify Control Plane API Server on Port 3000 in background
echo "[CloudOps Entrypoint] Starting Control Plane API Server (Port $API_PORT)..."
node apps/api/dist/server.js &
API_PID=$!

# 3. Launch Next.js Operator Web UI on Port 3001 in background
echo "[CloudOps Entrypoint] Starting Operator Web UI (Port $PORT)..."
node_modules/.bin/next start apps/web -p "$PORT" &
WEB_PID=$!

# 4. Graceful Shutdown Signal Trap
shutdown() {
  echo "[CloudOps Entrypoint] Received termination signal. Stopping servers..."
  kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
  echo "[CloudOps Entrypoint] All services stopped cleanly."
  exit 0
}

trap shutdown SIGINT SIGTERM

echo "=== CloudOps Unified Container Ready ==="
echo " • API Control Plane: http://0.0.0.0:$API_PORT"
echo " • Operator Web UI:   http://0.0.0.0:$PORT"

# Wait for any process to exit
wait -n "$API_PID" "$WEB_PID"
EXIT_CODE=$?

echo "[CloudOps Entrypoint] Process exited with code $EXIT_CODE. Shutting down..."
kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
exit "$EXIT_CODE"
