# Uses Docker BuildKit's bundled Dockerfile frontend.
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/test_support/package.json packages/test_support/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --fetch-timeout=180000

COPY tsconfig.base.json tsconfig.build.json tsconfig.json ./
COPY apps apps
COPY packages packages
COPY LICENSE ./
COPY THIRD_PARTY_NOTICES.md ./
COPY docs/dependencies docs/dependencies
RUN --network=none pnpm run build
RUN --network=none pnpm --offline --config.trust-lockfile=true --config.inject-workspace-packages=true --filter @struinfo/server deploy --prod --no-optional /runtime-server

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime

ARG STRUIINFO_VERSION=0.5.0
ENV NODE_ENV=production
WORKDIR /opt/struinfo/apps/server

LABEL org.opencontainers.image.title="StruInfo" \
  org.opencontainers.image.version="${STRUIINFO_VERSION}" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.source="https://github.com/tntexploding/StruInfo"

# Build tools stay in the glibc build stage. The runtime uses only JavaScript
# dependencies and static assets; optional native PDF Canvas is excluded above.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && addgroup -g 10001 struinfo \
  && adduser -u 10001 -G struinfo -D -H -h /nonexistent -s /sbin/nologin struinfo

COPY --from=build --chown=10001:10001 /runtime-server/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /workspace/apps/server/dist ./dist
COPY --from=build --chown=10001:10001 /workspace/apps/server/migrations ./migrations
COPY --from=build --chown=10001:10001 /workspace/apps/server/package.json ./package.json
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist /opt/struinfo/apps/web/dist
COPY --from=build --chown=10001:10001 /workspace/LICENSE /opt/struinfo/LICENSE
COPY --from=build --chown=10001:10001 /workspace/THIRD_PARTY_NOTICES.md /opt/struinfo/THIRD_PARTY_NOTICES.md
COPY --from=build --chown=10001:10001 /workspace/docs/dependencies/licenses /opt/struinfo/licenses
COPY --from=build --chown=10001:10001 /workspace/docs/dependencies/sbom/npm-closure.spdx.json /opt/struinfo/npm-closure.spdx.json

USER 10001:10001
EXPOSE 3000

CMD ["node", "dist/entrypoints/all.js"]
