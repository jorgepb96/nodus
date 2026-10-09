# SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
# SPDX-License-Identifier: AGPL-3.0-only

# The renderer output is architecture-independent. Build it on the runner's native
# platform so multi-platform releases do not execute npm/Vite through QEMU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web-build

WORKDIR /src
COPY package.json package-lock.json ./
# The web renderer needs Vite/React only. Ignoring lifecycle scripts avoids downloading
# Electron and compiling native desktop dependencies inside the server image build.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:server-web
RUN node scripts/generate-third-party-licenses.mjs --server-web

FROM node:22-alpine

ARG NODUS_VERSION=5.8.1
ARG NODUS_REVISION=unknown
LABEL org.opencontainers.image.title="Nodus Server" \
      org.opencontainers.image.description="Experimental self-hosted Nodus MCP server" \
      org.opencontainers.image.source="https://github.com/jorgepb96/nodus" \
      org.opencontainers.image.url="https://github.com/jorgepb96/nodus" \
      org.opencontainers.image.documentation="https://github.com/jorgepb96/nodus/blob/v5.8.1/server/README.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${NODUS_VERSION}" \
      org.opencontainers.image.revision="${NODUS_REVISION}" \
      app.nodus.stability="experimental"

RUN apk add --no-cache chromium font-noto font-noto-cjk

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/server.mjs ./
COPY server/lib ./lib
# Native vaults compile the canonical desktop migration source once at first use. Keep the
# source and its shared dependencies in the image so the server never forks a second schema.
COPY electron/db ./electron/db
COPY shared ./shared
# Server's per-user preference store and routes deliberately reuse the same portable
# contract as Desktop. Keep the preference module and its portable dependencies
# together because their relative imports resolve from /shared in the runtime image.
COPY shared/serverProfilePreferences.mjs /shared/serverProfilePreferences.mjs
COPY shared/appThemes.mjs /shared/appThemes.mjs
COPY shared/scriptorNavigation.mjs /shared/scriptorNavigation.mjs
COPY LICENSE SOURCE_CODE.md THIRD_PARTY_NOTICES.md ./
COPY --from=web-build /src/server/dist/web ./dist/web
COPY --from=web-build /src/legal/generated ./legal/generated

ENV NODUS_DATA_DIR=/data \
    NODUS_HOST=0.0.0.0 \
    NODUS_PORT=7443 \
    NODUS_SOURCE_URL=https://github.com/jorgepb96/nodus/tree/v5.8.1

RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 7443
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7443/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
