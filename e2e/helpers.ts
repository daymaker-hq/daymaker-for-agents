import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BUNDLE = fileURLToPath(new URL("../bin/daymaker-mcp.mjs", import.meta.url));

/** A key that looks right and is not one: the API answers it with its own 401. */
export const FAKE_KEY = "dmk_live_" + "x".repeat(43);

/** One raw JSON-RPC `initialize` POST, the way every client starts. */
export async function mcpInitialize(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "daymaker-for-agents-e2e", version: "0" } },
    }),
  });
  const text = await res.text();
  let body: { result?: unknown; error?: { code: number; message: string } } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the caller sees the status and an empty body.
  }
  return { status: res.status, headers: res.headers, body };
}

/** The committed bundle over stdio, the way the local examples start it. */
export async function stdioClient(env: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { ...(process.env as Record<string, string>), ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "daymaker-for-agents-e2e", version: "0" });
  await client.connect(transport);
  return client;
}

/** Runs the bundle to its end and returns what it printed. */
export function runBundle(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], {
      env: { ...(process.env as Record<string, string>), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Tool results are JSON in a single text block. */
export function toolJson<T = Record<string, unknown>>(res: unknown): T {
  const content = ((res as CallToolResult).content ?? []) as { type: string; text?: string }[];
  const text = content.find((c) => c.type === "text")?.text ?? "";
  return JSON.parse(text) as T;
}
