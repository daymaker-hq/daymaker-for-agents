# Changelog

## 0.4.1

- **The Claude Code plugin is now only the plugin.** It has a folder of its
  own, `plugins/daymaker`, with its manifest, its server file and its
  skill. In 0.4.0 the plugin was the whole repository, so installing it
  copied this repository's source into the plugin and, with Claude Code
  2.1.222, also installed its development packages, about 120 MB. The
  repository's `bin` folder no longer counts as the plugin's. The install
  commands are the same. Adding the marketplace still clones this
  repository, about 2 MB, and nothing in that clone is run or installed.
- **If you installed 0.4.0**, run these two commands in your shell:
  `claude plugin marketplace update daymaker`, then
  `claude plugin update daymaker@daymaker`. If you installed it for one
  project, run both in that project's folder and add `--scope project` or
  `--scope local` to the second. Claude Code removes the old copy by
  itself later.
- `@daymaker/sdk` and `@daymaker/mcp` now give today's price for research,
  45 credits, as the API's own description does. 0.4.0 said 37.5. Apart
  from that and the version number they are unchanged.

## 0.4.0

The first public release.

- **Plugins** for Claude Code, Devin, Antigravity and Agent Plugins 1.0
  clients. Each adds the hosted Daymaker MCP server
  (`https://daymaker.com/mcp`, sign in with your Daymaker account) and the
  `daymaker` skill.
- **`@daymaker/sdk`**: a typed client for the Daymaker API
  (`https://daymaker.com/api/v2`). One method per operation, inputs and
  answers typed from the published contract, a list iterator, an
  `Idempotency-Key` on every write that takes one, and retries only where
  they are safe.
- **`@daymaker/mcp`**: a local MCP server (stdio) with one tool per API
  operation, for clients that cannot sign in to the hosted server. Runs as
  `npx -y @daymaker/mcp` with `DAYMAKER_KEY`; `DAYMAKER_MCP_READ_ONLY` and
  `DAYMAKER_MCP_SCOPES` narrow what it offers.
- Setup steps for Claude Code, Claude, ChatGPT, Codex CLI, VS Code, Gemini
  CLI, OpenCode, Cursor, Devin Desktop (Cascade) and Cline in the README,
  with example files under `examples/agents/`.
- `server.json` for the MCP Registry (`com.daymaker/daymaker`).
