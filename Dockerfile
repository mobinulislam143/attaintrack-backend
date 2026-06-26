# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build — keeps the production image small and dependency-free.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY tsconfig.json ./

RUN npm ci --frozen-lockfile

COPY src ./src/

RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --frozen-lockfile --omit=dev

# Copy compiled output and generated Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
