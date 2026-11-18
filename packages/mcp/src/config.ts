import type { KeyScope } from "@daymaker/sdk";
import type { DaymakerMcpOptions } from "./server.js";
import { SCOPES } from "./tools.js";

/**
 * A yes or no setting. A safety switch must not fail open: a value that is
 * neither (`on`, `enabled`, a typo) stops the server instead of being read as no.
 */
function flag(name: string, v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "" || s === "0" || s === "false" || s === "no") return false;
  if (s === "1" || s === "true" || s === "yes") return true;
  throw new Error(`${name} is "${s}"; use 1 or 0`);
}

/** Reads DAYMAKER_KEY, DAYMAKER_API_URL, DAYMAKER_MCP_READ_ONLY and DAYMAKER_MCP_SCOPES. */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): DaymakerMcpOptions {
  const scopes = (env.DAYMAKER_MCP_SCOPES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = scopes.filter((s) => !SCOPES.includes(s as KeyScope));
  // A misspelt scope would quietly leave the server with no tools.
  if (unknown.length) {
    throw new Error(`DAYMAKER_MCP_SCOPES has ${unknown.map((s) => `"${s}"`).join(", ")}; the scopes are ${SCOPES.join(", ")}`);
  }
  return {
    readOnly: flag("DAYMAKER_MCP_READ_ONLY", env.DAYMAKER_MCP_READ_ONLY),
    ...(scopes.length ? { scopes: scopes as KeyScope[] } : {}),
    clientOptions: {
      ...(env.DAYMAKER_KEY ? { apiKey: env.DAYMAKER_KEY } : {}),
      ...(env.DAYMAKER_API_URL ? { baseUrl: env.DAYMAKER_API_URL } : {}),
    },
  };
}
