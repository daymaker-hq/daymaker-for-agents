import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@daymaker/sdk": fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
  },
});
