# syntax=docker/dockerfile:1

# ---- Abhängigkeiten ----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- Build -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Laufzeit ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data

RUN groupadd --system --gid 1001 noted \
 && useradd --system --uid 1001 --gid noted --home /app noted \
 && mkdir -p /data && chown noted:noted /data

COPY --from=build --chown=noted:noted /app/.next/standalone ./
COPY --from=build --chown=noted:noted /app/.next/static ./.next/static
COPY --from=build --chown=noted:noted /app/public ./public
COPY --from=build --chown=noted:noted /app/scripts/admin-cli.mjs ./scripts/admin-cli.mjs

USER noted
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
