// Writes the tool table in README.md from the built MCP tool list.
//   node scripts/docs.mjs          rewrite README.md
//   node scripts/docs.mjs --check  fail if README.md is stale
import { readFile, writeFile } from "node:fs/promises";
import { buildTools } from "../packages/mcp/dist/tools.js";
import { OPERATIONS } from "../packages/sdk/dist/index.js";

const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";
const path = new URL("../README.md", import.meta.url);

const rows = buildTools().map((t) => {
  const op = OPERATIONS[t.operationId];
  const notes = [
    op.scope === "send" ? "sends in your name" : "",
    op.credits ? "can use credits" : "",
    op.idempotency === "required" ? "Idempotency-Key required" : op.idempotency === "optional" ? "takes an Idempotency-Key" : "",
  ].filter(Boolean).join(", ");
  const summary = op.summary.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  return `| \`${t.name}\` | \`${t.operationId}\` | \`${op.method} ${op.path}\` | ${op.scope} | ${summary} | ${notes} |`;
});
const table = [
  START,
  "",
  `${rows.length} tools, one per Daymaker API operation. A tool's name is the snake_case of its SDK method.`,
  "",
  "| Tool | SDK method | Route | Scope | What it does | Notes |",
  "| ---- | ---------- | ----- | ----- | ------------ | ----- |",
  ...rows,
  "",
  END,
].join("\n");

const readme = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
const i = readme.indexOf(START);
const j = readme.indexOf(END);
if (i < 0 || j < 0) throw new Error("README.md is missing the tools markers");
const next = readme.slice(0, i) + table + readme.slice(j + END.length);
if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md tool table is stale: run `npm run docs`");
    process.exit(1);
  }
  console.log("README.md tool table is current");
} else {
  await writeFile(path, next);
  console.log(`README.md: ${rows.length} tools`);
}
