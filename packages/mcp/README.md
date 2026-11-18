# @daymaker/mcp

A local MCP server (stdio) for [Daymaker](https://daymaker.com): one tool per [Daymaker API](https://daymaker.com/api/v2/docs) operation, generated from the published contract. It calls the API with your API key, so it works in any MCP client that can start a local process.

If your client can sign in to an MCP server, you may not need this: add `https://daymaker.com/mcp` and sign in to Daymaker instead, with no key.

```bash
export DAYMAKER_KEY=dmk_live_...   # made in Daymaker under Settings, API and MCP
npx -y @daymaker/mcp               # speaks MCP on stdin and stdout
```

Your MCP client starts it for you:

```json
{
  "mcpServers": {
    "daymaker-api": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@daymaker/mcp"],
      "env": { "DAYMAKER_KEY": "${DAYMAKER_KEY}" }
    }
  }
}
```

| Environment variable | Default | Meaning |
| -------------------- | ------- | ------- |
| `DAYMAKER_KEY` | (required) | Your API key, `dmk_live_...` |
| `DAYMAKER_API_URL` | `https://daymaker.com/api/v2` | The API's address |
| `DAYMAKER_MCP_READ_ONLY` | unset | `1` offers only the tools that change nothing: reads and price checks |
| `DAYMAKER_MCP_SCOPES` | unset | A comma list of `read`, `work`, `send`: offers only the tools those scopes reach |

A key acts as the person who made it. Every tool outside the `read` scope is marked `destructiveHint`. The tools that send (gift links, payment pages, Reach out, public replies) say so in their description, and each needs an `idempotency_key` that the model makes up before the call, so a repeated call cannot send twice. Gift sends have a price check to run and show first. For an agent, a key without the `send` scope, or `DAYMAKER_MCP_READ_ONLY=1`, is the safest start.

Needs Node 22 or newer. The package is an ES module.

- Per-client setup, the tool list and the plugin: <https://github.com/daymaker-hq/daymaker-for-agents>
- API reference: <https://daymaker.com/api/v2/docs>
- Issues: <https://github.com/daymaker-hq/daymaker-for-agents/issues>
- Terms: <https://daymaker.com/terms>. Privacy: <https://daymaker.com/privacy>.

License: proprietary and source-visible. See `LICENSE` in this package.
