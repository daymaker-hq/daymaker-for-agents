#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isDaymakerError, SDK_VERSION } from "@daymaker/sdk";
import { optionsFromEnv } from "./config.js";
import { createDaymakerMcpServer } from "./server.js";

const HELP = `daymaker-mcp ${SDK_VERSION}
The Daymaker API as MCP tools, over stdio. Your MCP client starts it; you do not run it by hand.

Environment:
  DAYMAKER_KEY            Required. A dmk_live_ key, made in Daymaker under Settings, API and MCP.
  DAYMAKER_API_URL        The API's address. Default https://daymaker.com/api/v2.
  DAYMAKER_MCP_READ_ONLY  1 to offer only the tools that change nothing (reads and price checks).
  DAYMAKER_MCP_SCOPES     Comma-separated scopes (read, work, send) to offer only the tools your key reaches.

Docs: https://daymaker.com/api/v2/docs`;

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(SDK_VERSION);
} else if (arg === "--help" || arg === "-h") {
  console.log(HELP);
} else {
  // stdout carries JSON-RPC; everything for people goes to stderr.
  try {
    const server = createDaymakerMcpServer(optionsFromEnv());
    await server.connect(new StdioServerTransport());
    console.error("daymaker-mcp: ready on stdio");
  } catch (err) {
    // The SDK's own words offer an option to pass; this program has only the environment.
    const message =
      isDaymakerError(err) && err.code === "missing_api_key"
        ? "No Daymaker API key. Set DAYMAKER_KEY to a dmk_live_ key, made in Daymaker under Settings, API and MCP."
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`daymaker-mcp: ${message}`);
    process.exit(1);
  }
}
