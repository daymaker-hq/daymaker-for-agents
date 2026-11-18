// Checks the plugin manifests (Claude, Devin, Antigravity, Agent Plugins), the
// MCP configs and the generated agent examples parse and agree with each other,
// and that no file in the tree carries a real-looking Daymaker key.
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, AGENTS_DIR, KEY_ENV, KEY_PLACEHOLDER, MCP_URL, NPM_PACKAGE } from "./agents.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const read = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));
const need = (cond, msg) => { if (!cond) problems.push(msg); };
const onlyKeys = (obj, allowed, where) => {
  for (const k of Object.keys(obj)) need(allowed.includes(k), `${where}: unexpected field "${k}"`);
};
// The hosted server takes a sign-in only. A config that sends it a header, or
// names a key beside its URL, would teach people something that cannot work.
const hostedOnly = (server, where) => {
  need(server && !server.headers, `${where}: no headers; the hosted server takes a sign-in, not a key`);
  need(server && !server.env && !server.variables, `${where}: no key beside the hosted URL`);
};

const pkg = await read("package.json");
const sdk = await read("packages/sdk/package.json");
const mcpPkg = await read("packages/mcp/package.json");
const version = pkg.version;
need(sdk.version === version && mcpPkg.version === version, `workspace versions must match package.json ${version}`);
need(mcpPkg.dependencies?.["@daymaker/sdk"] === version, `packages/mcp must depend on @daymaker/sdk ${version}`);
need(mcpPkg.name === NPM_PACKAGE, `packages/mcp must be named ${NPM_PACKAGE}; the examples start it by that name`);
need((await readFile(join(root, "packages/sdk/src/version.ts"), "utf8")).includes(`"${version}"`), `packages/sdk/src/version.ts must say ${version}`);
need((await readFile(join(root, "CHANGELOG.md"), "utf8")).includes(`## ${version}`), `CHANGELOG.md needs a section for ${version}`);

// Claude Code: .claude-plugin/plugin.json + marketplace.json + root .mcp.json
const plugin = await read(".claude-plugin/plugin.json");
const market = await read(".claude-plugin/marketplace.json");
const mcp = await read(".mcp.json");
need(/^[a-z0-9-]+$/.test(plugin.name ?? ""), "plugin.json: name must be kebab-case");
need(plugin.version === version, `.claude-plugin/plugin.json version ${plugin.version} != package.json ${version}`);
need(typeof plugin.description === "string" && plugin.description.length > 0, "plugin.json: description required");
need(plugin.mcpServers === "./.mcp.json", "plugin.json: mcpServers must point at ./.mcp.json");
need(/^[a-z0-9-]+$/.test(market.name ?? ""), "marketplace.json: name must be kebab-case");
need(market.owner?.name, "marketplace.json: owner.name required");
const entry = market.plugins?.find((p) => p.name === plugin.name);
need(entry, "marketplace.json: must list the plugin by its plugin.json name");
need(entry?.source === "./", "marketplace.json: plugin source must be ./");
need(entry && !("version" in entry), "marketplace.json: leave the plugin's version out; plugin.json holds it");
need(market.metadata?.version === version, "marketplace.json: metadata.version must match package.json");

const remote = mcp.mcpServers?.daymaker;
need(remote?.type === "http", ".mcp.json: daymaker server must be type http");
need(remote?.url === MCP_URL, `.mcp.json: url must be ${MCP_URL} (a literal: Devin and Agent Plugins clients do not expand defaults)`);
hostedOnly(remote, ".mcp.json");
need(Object.keys(mcp.mcpServers ?? {}).length === 1, ".mcp.json: the plugin adds the hosted server only");

// Devin: .devin-plugin/plugin.json (reads the root .mcp.json by convention)
const devin = await read(".devin-plugin/plugin.json");
need(devin.name === plugin.name, ".devin-plugin/plugin.json: name must match the Claude manifest");
need(/^[a-z0-9]+([.-][a-z0-9]+)*$/.test(devin.name ?? ""), ".devin-plugin/plugin.json: name must be lowercase with single - or . separators");
need(devin.version === version, `.devin-plugin/plugin.json version ${devin.version} != ${version}`);
need(typeof devin.description === "string" && devin.description.length > 0, ".devin-plugin/plugin.json: description required");
// The fields Devin documents. Anything else is a guess about what its loader does with it.
onlyKeys(devin, ["name", "version", "description", "author", "homepage", "repository", "license", "keywords", "logo", "platforms"], ".devin-plugin/plugin.json");
need(!("mcpServers" in devin), ".devin-plugin/plugin.json: leave mcpServers out; the root .mcp.json is loaded by convention");

// Agent Plugins 1.0: root plugin.json + mcp.json (closed schemas)
const ap = await read("plugin.json");
need(ap.$schema === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "plugin.json: $schema must be the Agent Plugins 1.0.0 manifest schema");
need(ap.name === plugin.name, "plugin.json: name must match the Claude manifest");
need(ap.version === version, `plugin.json version ${ap.version} != ${version}`);
onlyKeys(ap, ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"], "plugin.json");
if (ap.author) onlyKeys(ap.author, ["name", "email", "url"], "plugin.json author");
const apMcp = await read("mcp.json");
need(apMcp.$schema === "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcp.json: $schema must be the Agent Plugins 1.0.0 MCP schema");
onlyKeys(apMcp, ["$schema", "mcpServers"], "mcp.json");
need(apMcp.mcpServers?.daymaker, "mcp.json: must list the daymaker server");
for (const [name, server] of Object.entries(apMcp.mcpServers ?? {})) {
  if (server.type === "streamable-http" || server.type === "sse") {
    onlyKeys(server, ["type", "url", "headers"], `mcp.json ${name}`);
    need(server.url === MCP_URL, `mcp.json ${name}: url must be ${MCP_URL}`);
    hostedOnly(server, `mcp.json ${name}`);
  } else if (server.type === "stdio") {
    onlyKeys(server, ["type", "command", "args", "env", "cwd"], `mcp.json ${name}`);
  } else {
    problems.push(`mcp.json ${name}: type must be stdio, streamable-http or sse`);
  }
}

// Antigravity: .antigravity-plugin/plugin.json + root mcp_config.json
const agy = await read(".antigravity-plugin/plugin.json");
need(agy.$schema === "https://antigravity.google/schemas/v1/plugin.json", ".antigravity-plugin/plugin.json: $schema must be the Antigravity v1 schema");
need(agy.name === plugin.name, ".antigravity-plugin/plugin.json: name must match the Claude manifest");
need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(agy.name ?? ""), ".antigravity-plugin/plugin.json: name must be kebab-case");
need(agy.version === version, `.antigravity-plugin/plugin.json version ${agy.version} != ${version}`);
need(agy.displayName && agy.description, ".antigravity-plugin/plugin.json: displayName and description required");
need(!agy.suggestedPrompts || agy.suggestedPrompts.length <= 3, ".antigravity-plugin/plugin.json: at most 3 suggestedPrompts");
onlyKeys(agy, ["$schema", "name", "displayName", "description", "version", "disabled", "logo", "suggestedPrompts", "skills", "author", "homepage", "repository", "license", "keywords", "extensions"], ".antigravity-plugin/plugin.json");
const agyMcp = await read("mcp_config.json");
const agyServer = agyMcp.mcpServers?.daymaker;
need((agyServer?.url ?? agyServer?.serverUrl) === MCP_URL, `mcp_config.json: daymaker url must be ${MCP_URL}`);
hostedOnly(agyServer, "mcp_config.json");

// MCP Registry: server.json + the mcpName the npm package claims
const server = await read("server.json");
need(server.name === mcpPkg.mcpName, `server.json name ${server.name} != packages/mcp mcpName ${mcpPkg.mcpName}`);
need(server.version === version, `server.json version ${server.version} != ${version}`);
need(typeof server.description === "string" && server.description.length <= 100, "server.json: description must be at most 100 characters");
need(server.repository?.url === "https://github.com/daymaker-hq/daymaker-for-agents", "server.json: repository must be this repository");
const registryRemote = server.remotes?.find((r) => r.type === "streamable-http" && r.url === MCP_URL);
need(registryRemote, `server.json: remotes must include the streamable-http ${MCP_URL}`);
if (registryRemote) hostedOnly(registryRemote, "server.json remote");
const npmPkg = server.packages?.find((p) => p.registryType === "npm");
need(npmPkg?.identifier === mcpPkg.name && npmPkg?.version === version, `server.json: npm package must be ${mcpPkg.name}@${version}`);
need(npmPkg?.environmentVariables?.some((v) => v.name === KEY_ENV && v.isSecret && v.isRequired), `server.json: ${KEY_ENV} must be a required secret input`);

// Skill shared by every plugin system
const skill = await readFile(join(root, "skills/daymaker/SKILL.md"), "utf8");
need(/^---\r?\nname: daymaker\r?\ndescription: .+\r?\n---/m.test(skill), "skills/daymaker/SKILL.md: frontmatter needs name and description");

// Generated agent examples: present, parseable, and the generator agrees (agents:check does the byte compare)
for (const agent of AGENTS) {
  for (const [file, content] of Object.entries(agent.files)) {
    const rel = `${AGENTS_DIR}/${agent.id}/${file}`;
    try {
      const text = await readFile(join(root, rel), "utf8");
      need(text.replace(/\r\n/g, "\n") === content, `${rel}: stale, run npm run agents`);
      if (file.endsWith(".json")) JSON.parse(text);
      need(!/authorization/i.test(text), `${rel}: no Authorization header; the hosted server takes a sign-in and the local server reads ${KEY_ENV}`);
    } catch (e) {
      problems.push(`${rel}: ${e.message}`);
    }
  }
}

// Secret scan: a real key is dmk_(live|test)_ (or the Cold Caked dm_ family)
// followed by a long random tail. The gitignored .env files are where a real
// key is meant to live. No file may link into another repository of the
// organisation: this one stands alone.
const SKIP = new Set(["node_modules", ".git", "dist", "coverage"]);
const IGNORED_ENV = (name) => /^\.env(\..+)?$/.test(name) && name !== ".env.example";
const KEY = /dmk?_(live|test)_[A-Za-z0-9_-]{20,}/g;
const PRIVATE_REPO_URL = /github\.com\/daymaker-hq\/(?!daymaker-for-agents\b)[A-Za-z0-9_.-]+/g;
async function walk(dir) {
  for (const name of await readdir(dir)) {
    if (SKIP.has(name) || IGNORED_ENV(name)) continue;
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) { await walk(p); continue; }
    if (/\.(png|jpg|ico|lock)$/.test(name)) continue;
    const rel = relative(root, p);
    const text = await readFile(p, "utf8");
    for (const m of text.match(KEY) ?? []) {
      if (m !== KEY_PLACEHOLDER && !/^dmk?_(live|test)_[x0]+$/.test(m)) problems.push(`${rel}: looks like a real key (${m.slice(0, 12)}...)`);
    }
    for (const m of text.match(PRIVATE_REPO_URL) ?? []) {
      problems.push(`${rel}: links into another repository (${m}); only github.com/daymaker-hq/daymaker-for-agents is allowed`);
    }
  }
}
await walk(root);

if (problems.length) {
  console.error(problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
console.log(`manifests ok (${AGENTS.length} agent configs), no keys found`);
