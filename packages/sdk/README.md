# @daymaker/sdk

Typed TypeScript client for the [Daymaker API](https://daymaker.com/api/v2/docs): leads and research, gift ideas and picks, campaigns, sending, orders, the pipeline and signals.

```bash
npm install @daymaker/sdk
export DAYMAKER_KEY=dmk_live_...   # made in Daymaker under Settings, API and MCP
```

```ts
import { DaymakerClient } from "@daymaker/sdk";

const dm = new DaymakerClient(); // reads DAYMAKER_KEY

const me = await dm.getMe();
const { leads } = await dm.listLeads({ tab: "gift_ready", limit: 10 });
```

A key acts as the person who made it: their role, their team, their credits and their limits, exactly as in the Daymaker app. Keep it on a server.

- One method per API operation (`dm.listLeads`, `dm.researchLead`, `dm.sendGiftLinks`, ...), with typed inputs and answers generated from the published contract.
- `dm.pages(...)` reads a list to the end.
- An `Idempotency-Key` on every write that takes one, reused across retries, so a retry never acts twice.
- Retries with backoff only where they are safe, and typed `DaymakerError`s that carry the API's `code`.

Needs Node 22 or newer. The package is an ES module.

- API reference: <https://daymaker.com/api/v2/docs>
- Contract: `GET https://daymaker.com/api/v2/openapi.json`
- Source, examples and full docs: <https://github.com/daymaker-hq/daymaker-for-agents>
- Issues: <https://github.com/daymaker-hq/daymaker-for-agents/issues>
- Terms: <https://daymaker.com/terms>. Privacy: <https://daymaker.com/privacy>.

License: proprietary and source-visible. See `LICENSE` in this package.
