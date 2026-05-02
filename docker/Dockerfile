### Stage 1: Build the PWA ###
FROM oven/bun:1.1 AS pwa-build
WORKDIR /app
COPY package.json bun.lockb* ./
COPY apps/pwa/package.json apps/pwa/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile || bun install
COPY apps/pwa apps/pwa
WORKDIR /app/apps/pwa
RUN bun run build

### Stage 2: Build the server ###
FROM oven/bun:1.1 AS server-build
WORKDIR /app
COPY package.json bun.lockb* ./
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile || bun install
COPY apps/server apps/server

### Stage 3: Runtime ###
FROM oven/bun:1.1-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

# sqlite-vec is loaded as an extension at runtime if present.
# We do NOT bundle a binary here — users who want vector search install via
# bun install (which pulls platform-appropriate prebuilt binaries) below.

COPY --from=server-build /app/node_modules /app/node_modules
COPY --from=server-build /app/apps/server /app/apps/server
COPY --from=pwa-build /app/apps/pwa/build /app/apps/pwa/build
COPY package.json /app/package.json

ENV NODE_ENV=production
ENV DB_PATH=/data/swift-newt.sqlite
ENV PWA_DIST=/app/apps/pwa/build
ENV PORT=8787
EXPOSE 8787
VOLUME ["/data"]

WORKDIR /app/apps/server
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "bun run src/db/migrate.ts && bun run src/index.ts"]
