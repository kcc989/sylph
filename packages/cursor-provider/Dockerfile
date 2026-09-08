FROM oven/bun:1.2.7 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun build packages/cursor-provider/src/main.ts --target=node --outfile=/cursor.mjs

FROM node:24-alpine
WORKDIR /app
COPY --from=build /cursor.mjs ./cursor.mjs
EXPOSE 8080
CMD ["node", "cursor.mjs"]
