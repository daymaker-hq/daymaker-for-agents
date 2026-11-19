// What Claude Code puts on a person's machine when they install the plugin is
// the folder the marketplace entry names, copied whole. When that folder has
// a package.json and a lockfile, Claude Code can install its packages too.
// In 0.4.0 the folder was this repository's root, so an install copied the
// tests, the scripts and the Dockerfile, and Claude Code 2.1.222 also
// installed the workspace's 174 packages (about 120 MB).
//
// The plugin has a folder of its own, and these tests pin what is in it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENTS, MCP_URL, REMOTE_NAME } from "../scripts/agents.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const text = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const json = (rel: string) => JSON.parse(text(rel));

/** Every file under a folder, with forward slashes. Nothing is skipped. */
function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

const market = json(".claude-plugin/marketplace.json");
const entry = market.plugins.find((p: { name: string }) => p.name === "daymaker");
const source: string = entry?.source;
/** The folder is the repository root in 0.4.0. Every test that reads the folder stops there first. */
const notTheRoot = () => expect(resolve(ROOT, source)).not.toBe(resolve(ROOT));

describe("the Claude Code plugin's folder", () => {
  it("is a folder of the plugin's own, below the repository root", () => {
    // One plugin only: a second entry could name the root again and no test here would read it.
    expect(market.plugins.map((p: { name: string }) => p.name)).toEqual(["daymaker"]);
    expect(source).toMatch(/^\.\/[a-z0-9-]+(\/[a-z0-9-]+)*$/);
    notTheRoot();
  });

  it("holds the plugin's manifest, its server file and its skill, and nothing else", () => {
    notTheRoot();
    const files = filesUnder(join(ROOT, source)).sort();
    // A package.json here can make Claude Code install its packages on the person's machine.
    expect(files).not.toContain("package.json");
    // A top-level bin folder puts its files on the shell's path, and claude.ai and Cowork refuse the plugin.
    expect(files.filter((f) => f.startsWith("bin/"))).toEqual([]);
    expect(files).toEqual([".claude-plugin/plugin.json", ".mcp.json", "skills/daymaker/SKILL.md"]);
  });

  it("carries the same skill the other plugin systems read from the root", () => {
    notTheRoot();
    expect(lf(text(`${source}/skills/daymaker/SKILL.md`))).toBe(lf(text("skills/daymaker/SKILL.md")));
  });

  it("adds the hosted server from a file of its own, with a sign-in and no key", () => {
    notTheRoot();
    const manifest = json(`${source}/.claude-plugin/plugin.json`);
    expect(manifest.name).toBe("daymaker");
    // A file, not an inline entry: with the server written into the manifest, Claude Code's
    // plugin details list no server although it loads.
    expect(manifest.mcpServers).toBe("./.mcp.json");
    const servers = json(`${source}/.mcp.json`);
    expect(servers).toEqual({ mcpServers: { [REMOTE_NAME]: { type: "http", url: MCP_URL } } });
    // The same file the root carries, and the same the Claude Code example gives.
    expect(servers).toEqual(json(".mcp.json"));
    expect(servers).toEqual(JSON.parse(AGENTS.find((a) => a.id === "claude-code")!.files[".mcp.json"]!));
  });

  it("leaves the repository root with the marketplace file only, so the root is no plugin", () => {
    expect(existsSync(join(ROOT, ".claude-plugin/plugin.json"))).toBe(false);
    expect(filesUnder(join(ROOT, ".claude-plugin"))).toEqual(["marketplace.json"]);
  });
});
