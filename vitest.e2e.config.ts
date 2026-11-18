// Keyless end-to-end checks: the hosted MCP server's sign-in documents, every
// agent config and the stdio bundle. Needs the network, no secret.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@daymaker/sdk": fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url)),
      "@daymaker/mcp": fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
