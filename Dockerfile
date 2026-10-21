# ============================================================================
# Stage 1: Dependency Installation & Verification
# ============================================================================
FROM node:20-alpine AS deps
WORKDIR /app

# Install dumb-init for proper PID 1 signal forwarding (SIGTERM graceful drain)
RUN apk add --no-cache dumb-init

COPY package.json package-lock.json* ./
COPY scripts/clean-node-modules.js ./scripts/clean-node-modules.js
RUN npm ci --omit=dev && npm cache clean --force

# ============================================================================
# Stage 2: Automated Test & Lint Verification Stage
# ============================================================================
FROM node:20-alpine AS test
WORKDIR /app
COPY package.json package-lock.json* ./
COPY scripts/clean-node-modules.js ./scripts/clean-node-modules.js
RUN npm ci
COPY src ./src
COPY tests ./tests
RUN npm run lint && npm test

# ============================================================================
# Stage 3: Hardened Non-Root Production Runtime Image
# ============================================================================
FROM node:20-alpine AS production-nonroot
WORKDIR /app

ARG APP_VERSION=1.4.2
ARG GIT_COMMIT_SHA=a9f4c82

ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION} \
    GIT_COMMIT_SHA=${GIT_COMMIT_SHA} \
    EXECUTION_MODE=hybrid

# Copy dumb-init binary from deps stage
COPY --from=deps /usr/bin/dumb-init /usr/bin/dumb-init

# Create dedicated non-root system user and group (UID/GID 1001)
RUN addgroup -g 1001 -S devops && \
    adduser -S aegis -u 1001 -G devops

# Copy production node_modules and source code with non-root ownership
COPY --chown=aegis:devops --from=deps /app/node_modules ./node_modules
COPY --chown=aegis:devops package.json ./
COPY --chown=aegis:devops src ./src

USER aegis

EXPOSE 3000

# Container-level healthcheck probing Kubernetes Liveness endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]
