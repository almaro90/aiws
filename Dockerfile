FROM oven/bun:1.3.11-alpine AS build

WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/web build
RUN bun build apps/server/src/index.ts --compile --outfile /out/aiws-server
RUN bun build apps/cli/src/index.ts --compile --outfile /out/aiws
RUN bun build apps/runner/src/index.ts --compile --outfile /out/aiws-runner

FROM oven/bun:1.3.11-alpine AS agent
LABEL org.opencontainers.image.title="AIWS agent" \
  org.opencontainers.image.version="0.6.0" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
RUN apk add --no-cache git ca-certificates bash poppler-utils
WORKDIR /app
COPY --from=build /src/node_modules /app/node_modules
COPY --from=build /src/apps/runner/node_modules /app/apps/runner/node_modules
ENV PATH="/app/apps/runner/node_modules/.bin:${PATH}"
USER bun
WORKDIR /workspace

FROM docker:29-cli AS runner-manager
LABEL org.opencontainers.image.title="AIWS runner manager" \
  org.opencontainers.image.version="0.6.0" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
RUN apk add --no-cache git ca-certificates libstdc++ libgcc poppler-utils
COPY --from=build /out/aiws-runner /usr/local/bin/aiws-runner
ENTRYPOINT ["/usr/local/bin/aiws-runner"]

FROM alpine/git:v2.47.2 AS server
LABEL org.opencontainers.image.title="AIWS" \
  org.opencontainers.image.version="0.6.0" \
  org.opencontainers.image.licenses="AGPL-3.0-only"

USER root
RUN addgroup -S aiws \
  && adduser -S -D -H -u 1000 -G aiws aiws \
  && mkdir -p /app/docs/contracts /app/public /data \
  && chown -R aiws:aiws /app /data
WORKDIR /app
COPY --from=build --chown=aiws:aiws /out/aiws-server /app/aiws-server
COPY --from=build --chown=aiws:aiws /out/aiws /app/aiws
COPY --from=build --chown=aiws:aiws /src/docs/contracts/openapi.yaml /app/docs/contracts/openapi.yaml
COPY --from=build --chown=aiws:aiws /src/apps/web/dist/ /app/public/
COPY --from=build --chown=aiws:aiws /src/packages/sqlite/migrations/ /app/migrations/
COPY --from=build /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=build /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1

USER aiws
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/app/aiws-server", "healthcheck"]
ENTRYPOINT ["/app/aiws-server"]
