# Stage 1: Build the monorepo
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests for optimal layer caching
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY database/package.json ./database/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/approvals/package.json ./packages/approvals/
COPY packages/audit/package.json ./packages/audit/
COPY packages/capabilities/package.json ./packages/capabilities/
COPY packages/connector/package.json ./packages/connector/
COPY packages/events/package.json ./packages/events/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/identity/package.json ./packages/identity/
COPY packages/onboarding/package.json ./packages/onboarding/
COPY packages/policy/package.json ./packages/policy/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/security/package.json ./packages/security/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tools/package.json ./packages/tools/

# Install workspace dependencies
RUN npm ci

# Copy all source files
COPY . .

# Build all workspaces (TypeScript compiler + Next.js production build)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2: Production Runner
FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_HOST=0.0.0.0
ENV API_PORT=3000
ENV PORT=3001

# Copy entire built tree and node_modules from builder
COPY --from=builder /app /app

# Ensure entrypoint has executable permissions
RUN chmod +x /app/scripts/docker-entrypoint.sh

# Expose both Control Plane API (3000) and Operator Web UI (3001)
EXPOSE 3000 3001

# Run entrypoint script
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
