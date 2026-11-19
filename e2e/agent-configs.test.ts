// Every generated example under examples/agents/, checked against the two
// servers it can point at: the hosted one (a URL and nothing else, since it
// takes a sign-in) and the local one (the npm package and DAYMAKER_KEY).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENTS,
  KEY_ENV,
  KEY_PLACEHOLDER,
  LOCAL_ARGS,
  LOCAL_COMMAND,
  LOCAL_NAME,
  MCP_URL,
  NPM_PACKAGE,
  REMOTE_NAME,
  VSCODE_INSTALL_LINK,
  renderExamples,
  renderReadmeSection,
} from "../scripts/agents.mjs";
import { ROOT } from "./helpers.js";

const lf = (s: string) => s.replace(/\r\n/g, "\n");

/** Every `{...}` in a parsed config that looks like one server entry, with the name it sits under. */
function servers(value: unknown, name = "", out: { name: string; entry: Record<string, unknown> }[] = []) {
  if (!value || typeof value !== "object") return out;
  const o = value as Record<string, unknown>;
  if ("url" in o || "httpUrl" in o || "serverUrl" in o || "command" in o) out.push({ name, entry: o });
  else for (const [k, v] of Object.entries(o)) servers(v, k, out);
  return out;
}

describe("examples/agents", () => {
  it("is exactly what scripts/agents.mjs writes", async () => {
    for (const [rel, content] of renderExamples()) {
      expect(lf(await readFile(join(ROOT, rel), "utf8")), rel).toBe(content);
    }
    expect(lf(await readFile(join(ROOT, "README.md"), "utf8"))).toContain(renderReadmeSection());
  });

  it("has a way in for every client", () => {
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length);
    for (const a of AGENTS) {
      const text = [...a.commands, ...Object.values(a.files)].join("\n");
      expect(["yes", "no", "untested"], a.id).toContain(a.signIn);
      // Only a client whose sign-in is known to work is shown how to add the hosted server.
      if (a.signIn === "yes") expect(text, `${a.id}: says it can sign in but never names the hosted server`).toContain(MCP_URL);
      else expect(text, `${a.id}: its sign-in is not known to work, so it must not name the hosted server`).not.toContain(MCP_URL);
      if (a.key) expect(text, `${a.id}: has a key but no local server`).toContain(NPM_PACKAGE);
      expect(a.signIn === "yes" || a.key, `${a.id}: no way in`).toBeTruthy();
      // A client that cannot sign in, or might not, says so in words, not only in the table.
      if (a.signIn !== "yes") expect(a.notes, a.id).toMatch(/local server/);
      expect(a.docs).toMatch(/^https:\/\//);
    }
  });

  const jsonFiles = AGENTS.flatMap((a) => Object.entries(a.files).filter(([f]) => f.endsWith(".json")).map(([f, c]) => ({ id: a.id, key: a.key, file: `${a.id}/${f}`, content: c })));

  it.each(jsonFiles)("$file: a hosted entry is a URL and nothing else", ({ content, file }) => {
    for (const { name, entry } of servers(JSON.parse(content))) {
      const url = entry.url ?? entry.httpUrl ?? entry.serverUrl;
      if (url === undefined) continue;
      expect(url, file).toBe(MCP_URL);
      expect(name, file).toBe(REMOTE_NAME);
      // The hosted server takes a sign-in: a header or a key beside its URL could never work.
      expect(entry.headers, file).toBeUndefined();
      expect(entry.env, file).toBeUndefined();
      expect(JSON.stringify(entry), file).not.toMatch(/dmk_|DAYMAKER_KEY|authorization/i);
    }
  });

  it.each(jsonFiles)("$file: a local entry starts the npm package with the key", ({ content, file, key }) => {
    for (const { name, entry } of servers(JSON.parse(content))) {
      if (entry.command === undefined) continue;
      expect(name, file).toBe(LOCAL_NAME);
      const argv = Array.isArray(entry.command) ? entry.command : [entry.command, ...((entry.args as string[]) ?? [])];
      expect(argv, file).toEqual([LOCAL_COMMAND, ...LOCAL_ARGS]);
      const env = (entry.env ?? entry.environment) as Record<string, string> | undefined;
      expect(Object.keys(env ?? {}), file).toEqual([KEY_ENV]);
      const value = env![KEY_ENV]!;
      if (key === "paste") expect(value, file).toBe(KEY_PLACEHOLDER);
      else expect(value, file).not.toMatch(/^dmk_/);
    }
  });

  it("codex: the hosted server by URL, the local one with the key passed through", () => {
    const toml = AGENTS.find((a) => a.id === "codex")!.files["config.toml"]!;
    expect(toml).toContain(`[mcp_servers.${REMOTE_NAME}]\nurl = "${MCP_URL}"\n`);
    expect(toml).toContain(`[mcp_servers.${LOCAL_NAME}]\ncommand = "${LOCAL_COMMAND}"\nargs = ["-y", "${NPM_PACKAGE}"]\nenv_vars = ["${KEY_ENV}"]\n`);
    expect(toml).not.toMatch(/bearer|dmk_/i);
  });

  it("the committed placeholder is visibly not a key", () => {
    expect(KEY_PLACEHOLDER).toMatch(/^dmk_live_x+$/);
  });

  it("the VS Code install link is VS Code's own address behind its redirect, with the hosted URL and no key", () => {
    const link = new URL(VSCODE_INSTALL_LINK);
    expect(link.origin + link.pathname).toBe("https://vscode.dev/redirect");
    const inner = link.searchParams.get("url")!;
    expect(inner.startsWith("vscode:mcp/install?")).toBe(true);
    const config = JSON.parse(decodeURIComponent(inner.slice("vscode:mcp/install?".length)));
    expect(config).toEqual({ name: REMOTE_NAME, type: "http", url: MCP_URL });
  });

  it("the Claude Code example is this repository's own .mcp.json", async () => {
    const rootMcp = lf(await readFile(join(ROOT, ".mcp.json"), "utf8"));
    expect(JSON.parse(rootMcp)).toEqual(JSON.parse(AGENTS.find((a) => a.id === "claude-code")!.files[".mcp.json"]!));
  });
});
