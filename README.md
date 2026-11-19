# Daymaker for agents

[Daymaker](https://daymaker.com) finds people worth reaching, researches what they care about, picks gifts they would love, and sends them. This repository connects your agent to it: plugins for Claude Code and other agent clients, a local MCP server, and a typed TypeScript SDK for the [Daymaker API](https://daymaker.com/api/v2/docs).

Everything here runs on your side and calls the Daymaker API or the hosted Daymaker MCP server.

| Piece | What it is | Use it when |
| ----- | ---------- | ----------- |
| Hosted MCP server | `https://daymaker.com/mcp`. You sign in to Daymaker from your client; there is no key to manage | Your client can sign in to an MCP server. Start here. |
| Plugins | Claude Code (`plugins/daymaker/`), Devin (`.devin-plugin/`), Antigravity (`.antigravity-plugin/`) and Agent Plugins 1.0 (`plugin.json`), each with the hosted server and the `daymaker` skill | You want Daymaker installed as a plugin |
| [`@daymaker/mcp`](packages/mcp) | A local MCP server (stdio) with one tool per API operation, using an API key | Your client cannot sign in to the hosted server, or you want a key with a narrow scope |
| [`@daymaker/sdk`](packages/sdk) | A typed TypeScript client for the Daymaker API | You are writing your own agent or backend |

Whichever way you connect, the agent acts as you in your own Daymaker workspace: your role, your team's limits and your credits apply, exactly as in the app.

## Quickstart

### Sign in (no key)

In Claude Code, install the plugin and sign in:

```text
/plugin marketplace add daymaker-hq/daymaker-for-agents
/plugin install daymaker@daymaker
/mcp
```

`/plugin install` opens the plugin's details: choose where to install it. Then `/mcp` lists the `daymaker` server; choose it and sign in to Daymaker. Other plugin systems:

```text
devin plugins install daymaker-hq/daymaker-for-agents                          # Devin
agy plugin install https://github.com/daymaker-hq/daymaker-for-agents          # Antigravity
```

A client that implements Agent Plugins 1.0 loads the root `plugin.json` and `mcp.json`. Without a plugin, add the server URL `https://daymaker.com/mcp` to your client and sign in when it asks; the table below has each client's steps.

Then ask:

> Who in my Daymaker leads has a gift ready to send?

### Use an API key

Make a key in Daymaker under **Settings, API and MCP** (<https://daymaker.com/autopilot/settings/api-and-mcp>). Keys start with `dmk_live_`. When you make one you choose what it may do:

| In the app | Scopes | It can |
| ---------- | ------ | ------ |
| Read only | `read` | See leads, campaigns, orders, the pipeline, signals and prices |
| Read and work | `read`, `work` | Also add leads, start research and gift searches (these use credits), pick gifts, write notes and change campaigns |
| Full access | `read`, `work`, `send` | Also send gift links, make payment pages, reach out by email and LinkedIn, and post public replies, all in your name |

A key acts as the person who made it. Keep it on a server or in your own environment: a key in a browser or an app is a key anyone can use.

```bash
export DAYMAKER_KEY=dmk_live_...
npx -y @daymaker/mcp          # the local MCP server, on stdin and stdout (Node 22 or newer)
```

Your MCP client starts that command for you; see the table below. From your own code:

```bash
npm install @daymaker/sdk
```

```ts
import { DaymakerClient } from "@daymaker/sdk";

const dm = new DaymakerClient(); // reads DAYMAKER_KEY

const me = await dm.getMe();
console.log(me.you?.email, me.credits?.balance);

const { leads } = await dm.listLeads({ tab: "gift_ready", limit: 10 });
for (const lead of leads) console.log(lead.lead_id, lead.name);
```

## Connect your client

<!-- agents:start -->

Sign in: the client adds `https://daymaker.com/mcp` and signs you in to Daymaker, with no key. API key: the client starts the local server (`npx -y @daymaker/mcp`), which reads `DAYMAKER_KEY`.

| Client | Sign in | API key for the local server | Example |
| ------ | ------- | ---------------------------- | ------- |
| Claude Code | yes | `DAYMAKER_KEY` from the environment | [`.mcp.json`](examples/agents/claude-code/.mcp.json), [`mcp.local.json`](examples/agents/claude-code/mcp.local.json) |
| Claude (claude.ai and Claude Desktop) | yes | pasted into the file | [`claude_desktop_config.json`](examples/agents/claude/claude_desktop_config.json) |
| ChatGPT | yes | no local server | none |
| Codex CLI | yes | `DAYMAKER_KEY` from the environment | [`config.toml`](examples/agents/codex/config.toml) |
| VS Code (Copilot) | yes | `DAYMAKER_KEY` from the environment | [`.mcp.json`](examples/agents/vscode/.mcp.json), [`mcp.local.json`](examples/agents/vscode/mcp.local.json) |
| Gemini CLI | yes | `DAYMAKER_KEY` from the environment | [`settings.json`](examples/agents/gemini-cli/settings.json), [`settings.local.json`](examples/agents/gemini-cli/settings.local.json) |
| OpenCode | yes | `DAYMAKER_KEY` from the environment | [`opencode.json`](examples/agents/opencode/opencode.json) |
| Cursor | not yet | `DAYMAKER_KEY` from the environment | [`mcp.json`](examples/agents/cursor/mcp.json) |
| Devin Desktop (formerly Windsurf), Cascade | not tested yet | `DAYMAKER_KEY` from the environment | [`mcp_config.json`](examples/agents/devin-desktop/mcp_config.json) |
| Cline | not tested yet | pasted into the file | [`cline_mcp_settings.json`](examples/agents/cline/cline_mcp_settings.json) |
| Any other MCP client | yes | `DAYMAKER_KEY` from the environment | [`mcp.json`](examples/agents/other/mcp.json) |

- **Claude Code.** Where: the plugin, the command below, or `.mcp.json` in the project root. The first two lines are typed inside Claude Code and install the plugin: the hosted server plus the `daymaker` skill. The third adds only the server. Either way, type `/mcp` and sign in to Daymaker. `mcp.local.json` is the local server with a key instead: copy its entry into `.mcp.json`. Docs: <https://code.claude.com/docs/en/mcp>
  ```text
  /plugin marketplace add daymaker-hq/daymaker-for-agents
  /plugin install daymaker@daymaker
  claude mcp add --transport http --scope user daymaker https://daymaker.com/mcp
  ```
- **Claude (claude.ai and Claude Desktop).** Where: Customize, then Connectors. The connector takes the server URL and signs you in. `claude_desktop_config.json` is for the local server in Claude Desktop: that file starts local servers only, and they get only a few variables from your environment, so the example carries a pasted key. Docs: <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp>
  ```text
  Customize > Connectors > Add > Add custom connector > a name and https://daymaker.com/mcp > Continue > Add > Connect > sign in to Daymaker
  ```
- **ChatGPT.** Where: Plugins, in ChatGPT on the web (chatgpt.com/plugins). No file to edit. Docs: <https://developers.openai.com/api/docs/guides/custom-mcp-server>
  ```text
  chatgpt.com/plugins > + > Add custom MCP server > a name > Server URL https://daymaker.com/mcp > authentication: OAuth > I understand and want to continue > Create as a plugin > Install > Connect > sign in to Daymaker
  ```
- **Codex CLI.** Where: `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project). `codex mcp login` opens the Daymaker sign-in. The second block of the file is the local server: `env_vars` passes `DAYMAKER_KEY` through from your shell. Docs: <https://developers.openai.com/codex/mcp>
  ```text
  codex mcp add daymaker --url https://daymaker.com/mcp
  codex mcp login daymaker
  ```
- **VS Code (Copilot).** Where: `.mcp.json` in the workspace root, or `~/.copilot/mcp-config.json`. The top-level key is `mcpServers`. VS Code asks you to sign in to Daymaker when the server starts. `mcp.local.json` is the local server: copy its entry into `.mcp.json`. VS Code fills in `${DAYMAKER_KEY}` from the environment it was started from. The older `.vscode/mcp.json` (top-level key `servers`) still loads, but VS Code has deprecated it, and a key asked for there with `${input:...}` does not reach Copilot sessions. Docs: <https://code.visualstudio.com/docs/agents/reference/mcp-configuration>
  ```text
  Install link: https://vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522daymaker%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fdaymaker.com%252Fmcp%2522%257D
  ```
- **Gemini CLI.** Where: `~/.gemini/settings.json` or `.gemini/settings.json` in the project. `httpUrl` selects Streamable HTTP; `url` would mean the older SSE transport. The second line is typed inside Gemini CLI and opens the Daymaker sign-in. `settings.local.json` is the local server: copy its entry into `settings.json`. Gemini CLI fills in `$DAYMAKER_KEY` from your shell. Docs: <https://geminicli.com/docs/tools/mcp-server/>
  ```text
  gemini mcp add --transport http daymaker https://daymaker.com/mcp
  /mcp auth daymaker
  ```
- **OpenCode.** Where: `opencode.json` in the project or `~/.config/opencode/opencode.json`. The command opens the Daymaker sign-in for the `remote` entry. The `local` entry is the local server; OpenCode's variable syntax is `{env:NAME}` without a dollar sign. Keep the one you use. The file is in the shape both OpenCode 1 and 2 read. Docs: <https://opencode.ai/docs/mcp-servers/>
  ```text
  opencode mcp auth daymaker
  ```
- **Cursor.** Where: `.cursor/mcp.json` in the project or `~/.cursor/mcp.json`. Use the local server. When Cursor registers with a hosted server it lists a `cursor://` return address next to its web and localhost ones, and Daymaker's sign-in refuses that registration for now. Cursor fills in `${env:DAYMAKER_KEY}` from the environment it was started from. Docs: <https://cursor.com/docs/mcp>
- **Devin Desktop (formerly Windsurf), Cascade.** Where: the file Cascade's `Open MCP config file` opens: `~/.config/devin/mcp_config.json`, or `%AppData%/devin/mcp_config.json` on Windows. The local server, which works with a key. Cascade fills in `${env:DAYMAKER_KEY}` from the environment. Press refresh in the MCPs panel after editing. Cascade can also sign in to hosted servers, but Daymaker has not tested its sign-in yet. Docs: <https://docs.devin.ai/windsurf/plugins/cascade/mcp>
- **Cline.** Where: `cline_mcp_settings.json` (the MCP Servers icon, then Configure, then Configure MCP Servers). The local server, which works with a key. Replace the placeholder with your key; the file is not in your repository. Cline can also sign in to hosted servers, but Daymaker has not tested its sign-in yet. Docs: <https://docs.cline.bot/mcp/mcp-overview>
- **Any other MCP client.** Where: your client's MCP server settings. The common `mcpServers` shape with both ways in; keep the one you use and map its fields to your client's format. The hosted entry works in a client that signs in to MCP servers and returns to a web address or to this computer. In any other client, use the local entry. If your client does not fill in `${DAYMAKER_KEY}`, paste the key there. Docs: <https://modelcontextprotocol.io/docs/getting-started/intro>

<!-- agents:end -->

Daymaker tests the Claude Code plugin. The Devin, Antigravity and Agent Plugins manifests follow each system's published format; if a sign-in does not complete in your client, use the local server with an API key and tell us at [contact@daymaker.com](mailto:contact@daymaker.com).

## The local MCP server

`@daymaker/mcp` gives your client one tool per Daymaker API operation. It needs Node 22 or newer.

```bash
DAYMAKER_KEY=dmk_live_... npx -y @daymaker/mcp
```

Or without npm, the single-file build in this repository:

```bash
git clone https://github.com/daymaker-hq/daymaker-for-agents && cd daymaker-for-agents
DAYMAKER_KEY=dmk_live_... node bin/daymaker-mcp.mjs
```

Or with Docker: `docker build -t daymaker-mcp . && docker run -i --rm -e DAYMAKER_KEY daymaker-mcp`.

| Environment variable | Default | Meaning |
| -------------------- | ------- | ------- |
| `DAYMAKER_KEY` | (required) | Your API key, `dmk_live_...` |
| `DAYMAKER_API_URL` | `https://daymaker.com/api/v2` | The API's address. Leave it alone unless Daymaker gives you another |
| `DAYMAKER_MCP_READ_ONLY` | unset | `1` offers only the tools that change nothing: reads and price checks |
| `DAYMAKER_MCP_SCOPES` | unset | A comma list of `read`, `work`, `send`: offers only the tools those scopes reach |

The tools the server lists do not depend on your key. A tool your key's scopes do not reach answers `insufficient_scope` and names the scope it needs. Set `DAYMAKER_MCP_SCOPES` to your key's scopes to hide those tools.

<!-- tools:start -->

30 tools, one per Daymaker API operation. A tool's name is the snake_case of its SDK method.

| Tool | SDK method | Route | Scope | What it does | Notes |
| ---- | ---------- | ----- | ----- | ------------ | ----- |
| `get_me` | `getMe` | `GET /me` | read | Your workspace |  |
| `list_leads` | `listLeads` | `GET /leads` | read | List leads |  |
| `add_leads` | `addLeads` | `POST /leads` | work | Add leads | can use credits, takes an Idempotency-Key |
| `get_lead` | `getLead` | `GET /leads/{lead_id}` | read | Get a lead |  |
| `research_lead` | `researchLead` | `POST /leads/{lead_id}/research` | work | Research a lead | can use credits, takes an Idempotency-Key |
| `find_work_email` | `findWorkEmail` | `POST /leads/{lead_id}/work-email` | work | Find a lead's work email | takes an Idempotency-Key |
| `find_gifts` | `findGifts` | `POST /leads/{lead_id}/gift-search` | work | Find gift ideas | can use credits, takes an Idempotency-Key |
| `choose_gift` | `chooseGift` | `PUT /leads/{lead_id}/gift` | work | Choose a gift | takes an Idempotency-Key |
| `clear_gift` | `clearGift` | `DELETE /leads/{lead_id}/gift` | work | Take the pick back | takes an Idempotency-Key |
| `set_gift_message` | `setGiftMessage` | `PUT /leads/{lead_id}/gift-message` | work | Write the gift's note | takes an Idempotency-Key |
| `list_campaigns` | `listCampaigns` | `GET /campaigns` | read | List campaigns |  |
| `create_campaign` | `createCampaign` | `POST /campaigns` | work | Create a campaign | takes an Idempotency-Key |
| `get_campaign` | `getCampaign` | `GET /campaigns/{campaign_id}` | read | Get a campaign |  |
| `update_campaign` | `updateCampaign` | `PATCH /campaigns/{campaign_id}` | work | Change a campaign | takes an Idempotency-Key |
| `review_send` | `reviewSend` | `POST /campaigns/{campaign_id}/send-review` | read | Review a send |  |
| `quote_gift_links` | `quoteGiftLinks` | `POST /campaigns/{campaign_id}/gift-links/quote` | read | Price gift links |  |
| `send_gift_links` | `sendGiftLinks` | `POST /campaigns/{campaign_id}/gift-links` | send | Send gift links | sends in your name, Idempotency-Key required |
| `quote_checkout` | `quoteCheckout` | `POST /campaigns/{campaign_id}/checkout/quote` | read | Price a shipped send |  |
| `create_checkout` | `createCheckout` | `POST /campaigns/{campaign_id}/checkout` | send | Make a payment page for a shipped send | sends in your name, Idempotency-Key required |
| `quote_reach_out` | `quoteReachOut` | `POST /campaigns/{campaign_id}/reach-out/quote` | read | Price Reach out |  |
| `reach_out` | `reachOut` | `POST /campaigns/{campaign_id}/reach-out` | send | Reach out with a gift | sends in your name, Idempotency-Key required |
| `quote_purchase_checkout` | `quotePurchaseCheckout` | `POST /purchases/{purchase_id}/checkout/quote` | read | Price claimed gifts and yeses |  |
| `create_purchase_checkout` | `createPurchaseCheckout` | `POST /purchases/{purchase_id}/checkout` | send | Make a payment page for claimed gifts and yeses | sends in your name, Idempotency-Key required |
| `sync_purchase` | `syncPurchase` | `POST /purchases/{purchase_id}/sync` | send | Check and finish a purchase | sends in your name |
| `set_gift_outcome` | `setGiftOutcome` | `PUT /purchases/{purchase_id}/leads/{lead_id}/outcome` | work | Record what happened after a gift | takes an Idempotency-Key |
| `list_orders` | `listOrders` | `GET /orders` | read | List orders |  |
| `get_pipeline` | `getPipeline` | `GET /pipeline` | read | The pipeline |  |
| `list_signals` | `listSignals` | `GET /signals` | read | List signals |  |
| `decide_signal` | `decideSignal` | `POST /signals/{signal_id}/decision` | work | Sort a signal | takes an Idempotency-Key |
| `reply_to_signal` | `replyToSignal` | `POST /signals/{signal_id}/reply` | send | Reply to a signal | sends in your name, Idempotency-Key required |

<!-- tools:end -->

The hosted server at `https://daymaker.com/mcp` has its own tool list, curated for agents, with a few things the API does not have yet. Its list can change on Daymaker's side; your client shows the current one.

## The SDK

- **One method per operation**, named by the contract's `operationId` (`dm.listLeads`, `dm.researchLead`, `dm.sendGiftLinks`, ...). The input is one flat object: path, query and body fields side by side. Methods return the answer's body; `dm.request(id, input)` returns `{ data, status, requestId, idempotencyKey, idempotentReplay, attempts }`.
- **Types** for every input and answer come from the published contract ([`spec/openapi.json`](spec/openapi.json), served at `https://daymaker.com/api/v2/openapi.json`). A field with nothing in it is left out of an answer, so read a missing field as empty.
- **Lists.** `dm.pages("listLeads", { limit: 100 })` is an async iterator that follows `next_offset` to the end. A page can hold fewer than `limit`, so always continue from `next_offset`.
- **Idempotency.** Every write that takes an `Idempotency-Key` gets one: yours (`idempotency_key`), or a fresh UUID that the SDK reuses across its own retries. Once a request with a key has done something, a retry with the same key gets that first answer back (`idempotentReplay: true`) instead of acting twice. Daymaker keeps a key's answer for 24 hours.
- **Retries** (2 by default; `maxRetries` changes it). Timeouts, network errors and `500`, `502`, `503`, `504` are retried only where that is safe: a read, a price check, or a write that carries an `Idempotency-Key`. A `429` is waited out when its `Retry-After` is 30 seconds or less, and `409 idempotency_in_flight` (the first request with that key is still running) is waited out with the same key. `outcome_unknown`, `partially_done` and `in_progress` are never retried: the request may have acted, so check what was done first, and use a new key if you then send again. Redirects are never followed.
- **Errors** are `DaymakerError` with `status`, `code`, `message`, `requestId`, `fields`, `details` (everything the API said, such as `new_quote` or `needs`), `retryAfterMs` and `idempotencyKey`. Branch on `status` and `code`; `message` is for people and may change. Quote `requestId` when you ask Daymaker about a request.

## Sending safely

Sending is real money and real messages in your name, and it cannot be taken back. The API lets you show a person the price before a gift goes out:

1. **Price it first.** Each gift send has a price check that sends nothing and charges nothing: `quoteGiftLinks`, `quoteCheckout`, `quotePurchaseCheckout`, `quoteReachOut`. A public reply (`replyToSignal`) has none: show the person the exact words first.
2. **Show the person** who gets what and what it costs, and get a yes.
3. **Send the same selection** with the quote's `quote_revision`, and `total_usd` for a payment page. Reach out takes `total_usd` only: the quote's `total_if_all_say_yes_usd`. If the price or the selection moved, the answer is `409 quote_changed` with the new price: show it and ask again.

```ts
const leads = [{ lead_id: "lead_1", how: "email_link" as const }];

const { quote } = await dm.quoteGiftLinks({ campaign_id: "camp_1", leads });
// ...show `quote.lines` and `quote.total_if_all_claimed_usd` to the person and wait for a yes...
const sent = await dm.request("sendGiftLinks", { campaign_id: "camp_1", leads, quote_revision: quote.quote_revision! });
console.log(sent.status, sent.idempotencyKey); // keep the key: sending it again cannot send twice
```

A payment page is paid by a person, an owner or admin of the workspace, on Stripe. Nothing is charged until they pay. After they pay, `syncPurchase` finishes the purchase.

For an agent, the safest setup is a key that cannot send at all (Read only, or Read and work), or `DAYMAKER_MCP_READ_ONLY=1` on the local server. On the local server every tool outside the `read` scope is marked `destructiveHint`, the tools that send say so in their description, and each of them needs an `idempotency_key` that the model makes up before the call, so a call that is repeated because its answer was lost cannot send twice.

## Limits and errors

Each key may make 120 requests a minute, and each person 240 a minute across their keys. Research, gift searches and sends have the same per-person limits as in the app. Over a limit the API answers `429` with `Retry-After`.

Errors are JSON: `{ "error": { "code", "message", "request_id", ... } }`. `400` is a problem with the request (`fields` says where), `401` a missing or invalid key, `402` not enough credits, `403` a scope or a role the key does not have, `404` nothing by that id in your workspace, `409` a state that moved (a price, a payment page being made, work already under way), `422` understood but not done (over `max_credits`, a lead missing what the send needs, a refusal), `429` a limit, `502` a change whose end Daymaker could not confirm (`outcome_unknown`: check before trying again). The full list of codes is in the [API reference](https://daymaker.com/api/v2/docs).

## What is not possible yet

- **The hosted server takes a sign-in, not an API key.** For a key, use the local server or the SDK.
- **Cursor cannot sign in to the hosted server yet.** Use the local server in Cursor.
- **The two servers have different tool lists.** The hosted one is curated by Daymaker and has a few things the API does not have yet; the local one is exactly the API.
- **No test mode for writes.** Every `dmk_live_` key works in your real workspace. Give an agent a Read only key while you try things out.

Looking for cakes? The Cold Caked Cake API is a different API with its own keys (`dm_live_`, `dm_test_`): <https://coldcaked.com/docs/api>. Those keys do not work here, and Daymaker keys do not work there.

## Contributing

Issues and pull requests: <https://github.com/daymaker-hq/daymaker-for-agents>. Build and test with `npm ci && npm run build && npm run typecheck && npm test`. `npm run test:e2e` checks the hosted server's sign-in documents, the example files and the local server, with no key. The files under `examples/agents/`, the client table above and the two files under `plugins/daymaker/` that copy the root's skill and `.mcp.json` are generated by `npm run agents`.

## License

Proprietary and source-visible, for use with Daymaker's services under the [Daymaker Terms](https://daymaker.com/terms). See [LICENSE](LICENSE). The single-file build `bin/daymaker-mcp.mjs` contains open-source packages under their own licenses: see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
