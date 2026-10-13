# syntax=docker/dockerfile:1

# ---- Abhängigkeiten ----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 bringt fertige Binärdateien für Linux x64/arm64 mit. npm würde trotzdem node-gyp starten,
# das ohne Python scheitert – daher ohne Installationsskripte. Nur wenn es für diese Plattform keine fertige
# Binärdatei gibt, werden Build-Werkzeuge installiert und SQLite wird kompiliert.
RUN npm ci --no-audit --no-fund --ignore-scripts \
 && if ! node -e "new (require('better-sqlite3'))(':memory:').close()" 2> /dev/null; then \
      apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
      && npm rebuild better-sqlite3 --foreground-scripts \
      && node -e "new (require('better-sqlite3'))(':memory:').close()"; \
    fi

# ---- Build -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Version für Anzeige und Update-Erkennung (setzt scripts/auto-update.sh)
ARG APP_VERSION=""
ARG GIT_COMMIT=""
RUN npm run build

# ---- Laufzeit ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
ARG APP_VERSION=""
LABEL org.opencontainers.image.title="noted" \
      org.opencontainers.image.version="${APP_VERSION}"
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
