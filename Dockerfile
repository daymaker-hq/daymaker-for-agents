# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp/package.json packages/mcp/
RUN npm ci --ignore-scripts

FROM deps AS test
COPY . .
CMD ["sh", "-c", "npm run typecheck && npm test"]

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

# The stdio MCP server. Pass the key at run time, never at build time:
#   docker run -i --rm -e DAYMAKER_KEY daymaker-mcp
FROM node:22-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/daymaker-hq/daymaker-for-agents"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/sdk/package.json packages/sdk/
COPY --from=build /app/packages/sdk/dist packages/sdk/dist
COPY --from=build /app/packages/mcp/package.json packages/mcp/
COPY --from=build /app/packages/mcp/dist packages/mcp/dist
USER node
ENTRYPOINT ["node", "packages/mcp/dist/cli.js"]
