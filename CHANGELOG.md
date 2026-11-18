# Changelog

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
