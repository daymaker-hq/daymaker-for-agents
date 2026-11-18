// One table of agent clients -> the connect config each one wants.
//
//   node scripts/agents.mjs            # write examples/agents/** and the README section
//   node scripts/agents.mjs --check    # exit 1 if any of them is stale
//
// There are two ways in, and every entry here is one or both of them:
//   hosted  the Daymaker MCP server at MCP_URL. No key: the client signs the
//           person in to Daymaker (OAuth). It takes a sign-in only.
//   local   the stdio server (`npx -y @daymaker/mcp`, or bin/daymaker-mcp.mjs),
//           which calls the Daymaker API with an API key from DAYMAKER_KEY.
// The e2e suite (e2e/agent-configs.test.ts) imports AGENTS and checks every
// file against what those two servers really answer.
//
// Every statement about a client here was checked against that client's own
// documentation on 18 Nov 2026. These tools change fast: check again before a
// release, and never mark a sign-in "yes" without the client's documented
// return address or a live test.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_URL = "https://daymaker.com/mcp";
export const API_URL = "https://daymaker.com/api/v2";
export const OAUTH_RESOURCE_METADATA = "https://daymaker.com/.well-known/oauth-protected-resource/mcp";
export const OAUTH_SERVER_METADATA = "https://daymaker.com/.well-known/oauth-authorization-server";
export const KEY_ENV = "DAYMAKER_KEY";
export const REMOTE_NAME = "daymaker";
export const LOCAL_NAME = "daymaker-api";
export const REPO = "daymaker-hq/daymaker-for-agents";
export const NPM_PACKAGE = "@daymaker/mcp";
export const LOCAL_COMMAND = "npx";
export const LOCAL_ARGS = ["-y", NPM_PACKAGE];
/** A visibly fake key for clients that cannot read an environment variable. */
export const KEY_PLACEHOLDER = "dmk_live_" + "x".repeat(43);

const json = (o) => JSON.stringify(o, null, 2) + "\n";
const local = (keyValue, extra = {}) => ({ command: LOCAL_COMMAND, args: LOCAL_ARGS, env: { [KEY_ENV]: keyValue }, ...extra });

/** VS Code's documented install link: its own `vscode:mcp/install?{json}` address behind the vscode.dev redirect. */
export const VSCODE_INSTALL_CONFIG = { name: REMOTE_NAME, type: "http", url: MCP_URL };
export const VSCODE_INSTALL_LINK = `https://vscode.dev/redirect?url=${encodeURIComponent(
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify(VSCODE_INSTALL_CONFIG))}`,
)}`;

/**
 * signIn: whether the client can sign in to the hosted server.
 *           "yes"       its documented return address is a web address or this computer, which Daymaker accepts
 *           "no"        it cannot today, and the notes say why
 *           "untested"  it probably can, but neither its documentation nor a test of ours says so
 *         Only a "yes" entry shows how to add MCP_URL.
 * key:    how the local server's config gets the API key:
 *           env      the file names DAYMAKER_KEY and the client fills it in from the environment
 *           paste    the client sends values as written; paste the key (a placeholder is committed)
 *           null     no local config in this entry
 */
export const AGENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    signIn: "yes",
    key: "env",
    where: "the plugin, the command below, or `.mcp.json` in the project root",
    docs: "https://code.claude.com/docs/en/mcp",
    commands: [
      `/plugin marketplace add ${REPO}`,
      `/plugin install daymaker@daymaker`,
      `claude mcp add --transport http --scope user ${REMOTE_NAME} ${MCP_URL}`,
    ],
    notes:
      "The first two lines are typed inside Claude Code and install the plugin: the hosted server plus the `daymaker` skill. The third adds only the server. Either way, type `/mcp` and sign in to Daymaker. `mcp.local.json` is the local server with a key instead: copy its entry into `.mcp.json`.",
    files: {
      ".mcp.json": json({ mcpServers: { [REMOTE_NAME]: { type: "http", url: MCP_URL } } }),
      "mcp.local.json": json({ mcpServers: { [LOCAL_NAME]: { type: "stdio", ...local(`\${${KEY_ENV}}`) } } }),
    },
  },
  {
    id: "claude",
    name: "Claude (claude.ai and Claude Desktop)",
    signIn: "yes",
    key: "paste",
    where: "Customize, then Connectors",
    docs: "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
    commands: [`Customize > Connectors > Add > Add custom connector > a name and ${MCP_URL} > Continue > Add > Connect > sign in to Daymaker`],
    notes:
      "The connector takes the server URL and signs you in. `claude_desktop_config.json` is for the local server in Claude Desktop: that file starts local servers only, and they get only a few variables from your environment, so the example carries a pasted key.",
    files: {
      "claude_desktop_config.json": json({ mcpServers: { [LOCAL_NAME]: local(KEY_PLACEHOLDER) } }),
    },
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    signIn: "yes",
    key: null,
    where: "Plugins, in ChatGPT on the web (chatgpt.com/plugins)",
    docs: "https://developers.openai.com/api/docs/guides/custom-mcp-server",
    commands: [
      `chatgpt.com/plugins > + > Add custom MCP server > a name > Server URL ${MCP_URL} > authentication: OAuth > I understand and want to continue > Create as a plugin > Install > Connect > sign in to Daymaker`,
    ],
    notes: "No file to edit.",
    files: {},
  },
  {
    id: "codex",
    name: "Codex CLI",
    signIn: "yes",
    key: "env",
    where: "`~/.codex/config.toml` (or `.codex/config.toml` in a trusted project)",
    docs: "https://developers.openai.com/codex/mcp",
    commands: [`codex mcp add ${REMOTE_NAME} --url ${MCP_URL}`, `codex mcp login ${REMOTE_NAME}`],
    notes: "`codex mcp login` opens the Daymaker sign-in. The second block of the file is the local server: `env_vars` passes `DAYMAKER_KEY` through from your shell.",
    files: {
      "config.toml":
        `[mcp_servers.${REMOTE_NAME}]\n` +
        `url = "${MCP_URL}"\n` +
        `\n` +
        `# The local server with an API key (optional)\n` +
        `[mcp_servers.${LOCAL_NAME}]\n` +
        `command = "${LOCAL_COMMAND}"\n` +
        `args = [${LOCAL_ARGS.map((a) => `"${a}"`).join(", ")}]\n` +
        `env_vars = ["${KEY_ENV}"]\n`,
    },
  },
  {
    id: "vscode",
    name: "VS Code (Copilot)",
    signIn: "yes",
    key: "env",
    where: "`.mcp.json` in the workspace root, or `~/.copilot/mcp-config.json`",
    docs: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
    commands: [`Install link: ${VSCODE_INSTALL_LINK}`],
    notes:
      "The top-level key is `mcpServers`. VS Code asks you to sign in to Daymaker when the server starts. `mcp.local.json` is the local server: copy its entry into `.mcp.json`. VS Code fills in `${DAYMAKER_KEY}` from the environment it was started from. The older `.vscode/mcp.json` (top-level key `servers`) still loads, but VS Code has deprecated it, and a key asked for there with `${input:...}` does not reach Copilot sessions.",
    files: {
      ".mcp.json": json({ mcpServers: { [REMOTE_NAME]: { type: "http", url: MCP_URL } } }),
      "mcp.local.json": json({ mcpServers: { [LOCAL_NAME]: { type: "stdio", ...local(`\${${KEY_ENV}}`) } } }),
    },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    signIn: "yes",
    key: "env",
    where: "`~/.gemini/settings.json` or `.gemini/settings.json` in the project",
    docs: "https://geminicli.com/docs/tools/mcp-server/",
    commands: [`gemini mcp add --transport http ${REMOTE_NAME} ${MCP_URL}`, `/mcp auth ${REMOTE_NAME}`],
    notes:
      "`httpUrl` selects Streamable HTTP; `url` would mean the older SSE transport. The second line is typed inside Gemini CLI and opens the Daymaker sign-in. `settings.local.json` is the local server: copy its entry into `settings.json`. Gemini CLI fills in `$DAYMAKER_KEY` from your shell.",
    files: {
      "settings.json": json({ mcpServers: { [REMOTE_NAME]: { httpUrl: MCP_URL } } }),
      "settings.local.json": json({ mcpServers: { [LOCAL_NAME]: local(`$${KEY_ENV}`) } }),
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    signIn: "yes",
    key: "env",
    where: "`opencode.json` in the project or `~/.config/opencode/opencode.json`",
    docs: "https://opencode.ai/docs/mcp-servers/",
    commands: [`opencode mcp auth ${REMOTE_NAME}`],
    notes:
      "The command opens the Daymaker sign-in for the `remote` entry. The `local` entry is the local server; OpenCode's variable syntax is `{env:NAME}` without a dollar sign. Keep the one you use. The file is in the shape both OpenCode 1 and 2 read.",
    files: {
      "opencode.json": json({
        $schema: "https://opencode.ai/config.json",
        mcp: {
          [REMOTE_NAME]: { type: "remote", url: MCP_URL, enabled: true },
          [LOCAL_NAME]: { type: "local", command: [LOCAL_COMMAND, ...LOCAL_ARGS], environment: { [KEY_ENV]: `{env:${KEY_ENV}}` }, enabled: false },
        },
      }),
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    signIn: "no",
    key: "env",
    where: "`.cursor/mcp.json` in the project or `~/.cursor/mcp.json`",
    docs: "https://cursor.com/docs/mcp",
    commands: [],
    notes:
      "Use the local server. When Cursor registers with a hosted server it lists a `cursor://` return address next to its web and localhost ones, and Daymaker's sign-in refuses that registration for now. Cursor fills in `${env:DAYMAKER_KEY}` from the environment it was started from.",
    files: {
      "mcp.json": json({ mcpServers: { [LOCAL_NAME]: local(`\${env:${KEY_ENV}}`) } }),
    },
  },
  {
    id: "devin-desktop",
    name: "Devin Desktop (formerly Windsurf), Cascade",
    signIn: "untested",
    key: "env",
    where: "the file Cascade's `Open MCP config file` opens: `~/.config/devin/mcp_config.json`, or `%AppData%/devin/mcp_config.json` on Windows",
    docs: "https://docs.devin.ai/windsurf/plugins/cascade/mcp",
    commands: [],
    notes:
      "The local server, which works with a key. Cascade fills in `${env:DAYMAKER_KEY}` from the environment. Press refresh in the MCPs panel after editing. Cascade can also sign in to hosted servers, but Daymaker has not tested its sign-in yet.",
    files: {
      "mcp_config.json": json({ mcpServers: { [LOCAL_NAME]: local(`\${env:${KEY_ENV}}`) } }),
    },
  },
  {
    id: "cline",
    name: "Cline",
    signIn: "untested",
    key: "paste",
    where: "`cline_mcp_settings.json` (the MCP Servers icon, then Configure, then Configure MCP Servers)",
    docs: "https://docs.cline.bot/mcp/mcp-overview",
    commands: [],
    notes:
      "The local server, which works with a key. Replace the placeholder with your key; the file is not in your repository. Cline can also sign in to hosted servers, but Daymaker has not tested its sign-in yet.",
    files: {
      "cline_mcp_settings.json": json({ mcpServers: { [LOCAL_NAME]: local(KEY_PLACEHOLDER) } }),
    },
  },
  {
    id: "other",
    name: "Any other MCP client",
    signIn: "yes",
    key: "env",
    where: "your client's MCP server settings",
    docs: "https://modelcontextprotocol.io/docs/getting-started/intro",
    commands: [],
    notes:
      "The common `mcpServers` shape with both ways in; keep the one you use and map its fields to your client's format. The hosted entry works in a client that signs in to MCP servers and returns to a web address or to this computer. In any other client, use the local entry. If your client does not fill in `${DAYMAKER_KEY}`, paste the key there.",
    files: {
      "mcp.json": json({
        mcpServers: {
          [REMOTE_NAME]: { type: "http", url: MCP_URL },
          [LOCAL_NAME]: { type: "stdio", ...local(`\${${KEY_ENV}}`) },
        },
      }),
    },
  },
];

export const AGENTS_DIR = "examples/agents";

/** `[path relative to repo root, content]` for every generated example. */
export function renderExamples() {
  return AGENTS.flatMap((a) => Object.entries(a.files).map(([f, content]) => [`${AGENTS_DIR}/${a.id}/${f}`, content]));
}

const SIGN_IN_LABEL = { yes: "yes", no: "not yet", untested: "not tested yet" };
const KEY_LABEL = {
  env: "`DAYMAKER_KEY` from the environment",
  paste: "pasted into the file",
};

/** The README block between the agents markers. */
export function renderReadmeSection() {
  const rows = AGENTS.map((a) => {
    const files = Object.keys(a.files).map((f) => `[\`${f}\`](${AGENTS_DIR}/${a.id}/${f})`).join(", ") || "none";
    return `| ${a.name} | ${SIGN_IN_LABEL[a.signIn]} | ${a.key ? KEY_LABEL[a.key] : "no local server"} | ${files} |`;
  });
  const details = AGENTS.map((a) => {
    const parts = [`- **${a.name}.** Where: ${a.where}. ${a.notes} Docs: <${a.docs}>`];
    if (a.commands.length) parts.push(`  \`\`\`text`, ...a.commands.map((c) => `  ${c}`), `  \`\`\``);
    return parts.join("\n");
  });
  return [
    `Sign in: the client adds \`${MCP_URL}\` and signs you in to Daymaker, with no key. API key: the client starts the local server (\`${LOCAL_COMMAND} ${LOCAL_ARGS.join(" ")}\`), which reads \`${KEY_ENV}\`.`,
    ``,
    `| Client | Sign in | API key for the local server | Example |`,
    `| ------ | ------- | ---------------------------- | ------- |`,
    ...rows,
    ``,
    ...details,
  ].join("\n");
}

const START = "<!-- agents:start -->";
const END = "<!-- agents:end -->";
/** Windows checkouts with core.autocrlf carry CRLF; the repo content is LF. */
const lf = (s) => (s === null ? null : s.replace(/\r\n/g, "\n"));

export function spliceReadme(readme, section) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error(`README.md is missing the ${START} / ${END} markers`);
  return readme.slice(0, a + START.length) + "\n\n" + section + "\n\n" + readme.slice(b);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const check = process.argv.includes("--check");
  const stale = [];
  const want = new Map(renderExamples());
  const readmePath = join(root, "README.md");
  want.set("README.md", spliceReadme(lf(await readFile(readmePath, "utf8")), renderReadmeSection()));
  for (const [rel, content] of want) {
    const p = join(root, rel);
    const current = lf(await readFile(p, "utf8").catch(() => null));
    if (current === content) continue;
    stale.push(rel);
    if (!check) {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content);
    }
  }
  if (check && stale.length) {
    console.error(`agents: stale, run \`npm run agents\`:\n${stale.map((s) => `- ${s}`).join("\n")}`);
    process.exit(1);
  }
  console.log(check ? `agents: ${want.size} files current` : `agents: wrote ${stale.length} of ${want.size} files`);
}
