FROM oven/bun:1.2.7 AS build
WORKDIR /build
COPY package.json bun.lock ./
COPY patches patches
COPY apps/web/package.json apps/web/package.json
COPY apps/cursor-provider/package.json apps/cursor-provider/package.json
COPY packages/domain packages/domain
COPY packages/db/package.json packages/db/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/cursor-provider/src apps/cursor-provider/src
RUN bun run --cwd apps/cursor-provider build
FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --omit=dev --ignore-scripts cursor-opencode-provider@0.6.6
COPY --from=build /build/apps/cursor-provider/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
