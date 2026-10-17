# ============================================
# aem-mcp — production image for AWS EC2 (linux/amd64)
# ============================================
# Build (from Apple Silicon / any host):
#   docker buildx build --platform linux/amd64 \
#     -t aemalgorithm/aem-mcp:0.1.0 \
#     -t aemalgorithm/aem-mcp:latest \
#     --push .
#
# Run:
#   docker run -d --name aem-mcp -p 3000:3000 \
#     -e NODE_ENV=production \
#     -e AEM_BACKEND_URL=https://<backend>/api \
#     -e JWT_SECRET=<session-jwt-secret> \
#     aemalgorithm/aem-mcp:latest
# ============================================

# Stage 1: Build
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="aem-mcp" \
      org.opencontainers.image.description="AEM Journaler MCP server (Streamable HTTP)" \
      org.opencontainers.image.source="https://github.com/AEM-algorithm/aem-mcp"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build
COPY catalog ./catalog

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# VOLUME for OAuth persistence (device-codes, pairings, revocation) backup
# file. The /app/data path is created below; operators should mount a
# host directory to this path (e.g. `-v /srv/aem-mcp/data:/app/data`) so
# the in-process state survives container restarts.
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health >/dev/null || exit 1

CMD ["node", "-r", "dotenv/config", "build/index.js"]
