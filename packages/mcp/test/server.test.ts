import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { DaymakerClient, OPERATIONS } from "@daymaker/sdk";
import { buildTools, createDaymakerMcpServer, instructionsFor, optionsFromEnv, SERVER_INSTRUCTIONS, SERVER_NAME, toolName } from "../src/index.js";

const KEY = "dmk_live_" + "x".repeat(40);
const REVISION = "a".repeat(64);
const SEND = { campaign_id: "c1", leads: [{ lead_id: "l1", how: "email_link" }], quote_revision: REVISION, idempotency_key: "model-key-1" };
const SENDS = ["create_checkout", "create_purchase_checkout", "reach_out", "reply_to_signal", "send_gift_links"];

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | Error;

function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.length > 1 ? replies.shift()! : replies[0]!;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...r.headers } });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

async function connect(fetchImpl: typeof fetch, opts: Record<string, unknown> = {}) {
  const client = new DaymakerClient({ apiKey: KEY, fetch: fetchImpl, sleep: async () => {}, idempotencyKeyFactory: () => "idem-mcp" });
  const server = createDaymakerMcpServer({ client, ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp;
}

function json(res: unknown): Record<string, any> {
  const content = (res as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text);
}

const keysSent = (calls: { init: RequestInit }[]) => calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]);
const apiError = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ status, body: { error: { code, message: "x", request_id: "r", ...extra } } });

/** Words in a text that look like tool names, minus the field names and error codes the texts also use. */
const NOT_TOOLS = new Set([
  "max_credits", "quote_revision", "total_usd", "total_if_all_say_yes_usd", "idempotency_key", "purchase_id",
  "quote_changed", "outcome_unknown", "partially_done", "in_progress", "idempotency_in_flight",
]);
const toolsNamedIn = (text: string) => (text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((w) => !NOT_TOOLS.has(w));

describe("tool table", () => {
  it("has one tool per operation, named in snake_case", () => {
    expect(toolName("sendGiftLinks")).toBe("send_gift_links");
    expect(toolName("getMe")).toBe("get_me");
    expect(toolName("quotePurchaseCheckout")).toBe("quote_purchase_checkout");
    const tools = buildTools();
    expect(tools).toHaveLength(Object.keys(OPERATIONS).length);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const t of tools) expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("read-only keeps every tool that changes nothing, and no other", () => {
    const want = Object.values(OPERATIONS).filter((o) => o.scope === "read").map((o) => toolName(o.operationId)).sort();
    const got = buildTools({ readOnly: true }).map((t) => t.name).sort();
    expect(got).toEqual(want);
    expect(got).toEqual(expect.arrayContaining(["get_me", "list_leads", "quote_gift_links", "review_send"]));
    for (const n of ["send_gift_links", "research_lead", "reach_out", "sync_purchase", "clear_gift"]) expect(got).not.toContain(n);
    for (const t of buildTools({ readOnly: true })) expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("filters to the scopes a key holds", () => {
    const tools = buildTools({ scopes: ["read", "work"] });
    expect(tools.some((t) => OPERATIONS[t.operationId].scope === "work")).toBe(true);
    expect(tools.some((t) => OPERATIONS[t.operationId].scope === "send")).toBe(false);
    expect(buildTools({ scopes: [] })).toHaveLength(Object.keys(OPERATIONS).length);
    expect(buildTools({ readOnly: true, scopes: ["send"] })).toHaveLength(0);
  });

  it("the sends are exactly the tools the API guards with a required key", () => {
    const sends = buildTools().filter((t) => OPERATIONS[t.operationId].idempotency === "required").map((t) => t.name).sort();
    expect(sends).toEqual(SENDS);
  });

  it("a send cannot be called without a key the model made up first", () => {
    // A generated key comes back only with the answer. When the answer is lost (the client stops
    // waiting after about a minute; a send can take longer), a key the model holds is the only
    // thing that keeps a second call from sending twice.
    const byName = Object.fromEntries(buildTools().map((t) => [t.name, t]));
    for (const name of SENDS) {
      const t = byName[name]!;
      expect(t.inputSchema.required, name).toContain("idempotency_key");
      expect((t.inputSchema.properties.idempotency_key as { description: string }).description, name).toMatch(/^Required\. Make up a unique string before the call/);
      expect(t.description, name).toMatch(/Needs idempotency_key/);
      // Same arguments, same key: repeating the call changes nothing more.
      expect(t.annotations.idempotentHint, name).toBe(true);
    }
    // Everything else keeps the key optional.
    for (const t of buildTools().filter((t) => !SENDS.includes(t.name))) {
      expect(t.inputSchema.required ?? [], t.name).not.toContain("idempotency_key");
    }
    // The SDK's own table is untouched: there the key stays optional and is generated.
    expect(OPERATIONS.sendGiftLinks.inputSchema.required).not.toContain("idempotency_key");
  });

  it("says what each kind of send needs before it goes", () => {
    const byName = Object.fromEntries(buildTools().map((t) => [t.name, t]));
    for (const name of ["send_gift_links", "create_checkout", "create_purchase_checkout", "reach_out"]) {
      expect(byName[name]!.description, name).toMatch(/SENDS in the person's name[^\n]*Run its price check first/);
    }
    // A public reply has no price and no quote to show.
    expect(byName.reply_to_signal!.description).toMatch(/ACTS in public in the person's name/);
    expect(byName.reply_to_signal!.description).not.toMatch(/price check first|the price,/);
    // Finishing a paid purchase is safe to repeat: it carries no warning it cannot honour.
    expect(byName.sync_purchase!.description).not.toMatch(/SENDS|ACTS|cannot be taken back/);
  });

  it("promises 'only adds' for no tool outside the read scope", () => {
    for (const t of buildTools()) {
      const read = OPERATIONS[t.operationId].scope === "read";
      expect(t.annotations.readOnlyHint, t.name).toBe(read);
      expect(t.annotations.destructiveHint, t.name).toBe(!read);
    }
  });

  it("tells the model to agree a ceiling before credits are used", () => {
    const credit = buildTools().filter((t) => OPERATIONS[t.operationId].credits);
    expect(credit.map((t) => t.name)).toEqual(expect.arrayContaining(["research_lead", "find_gifts", "add_leads"]));
    for (const t of credit) {
      expect(t.description, t.name).toMatch(/max_credits/);
      expect(Object.keys(t.inputSchema.properties), t.name).toContain("max_credits");
    }
  });

  it("does not call a POST with a generated key idempotent", () => {
    const byName = Object.fromEntries(buildTools().map((t) => [t.name, t]));
    expect(byName.research_lead!.annotations.idempotentHint).toBe(false);
    expect(byName.create_campaign!.annotations.idempotentHint).toBe(false);
    expect(byName.sync_purchase!.annotations.idempotentHint).toBe(false);
    expect(byName.choose_gift!.annotations.idempotentHint).toBe(true);
    expect(byName.clear_gift!.annotations.idempotentHint).toBe(true);
    expect(byName.quote_gift_links!.annotations).toMatchObject({ idempotentHint: true, readOnlyHint: true, destructiveHint: false });
  });

  it("keeps descriptions short enough for a tool list, names the route once, and gives no raw-HTTP advice", () => {
    for (const t of buildTools()) {
      expect(t.description.length, t.name).toBeLessThanOrEqual(1800);
      expect(t.description, t.name).toMatch(/\/api\/v2\//);
      expect(t.description.match(/scope: /gi)?.length ?? 0, t.name).toBe(1);
      expect(t.description + JSON.stringify(t.inputSchema), t.name).not.toMatch(/%2B/i);
    }
  });
});

describe("optionsFromEnv", () => {
  it("reads the key, the address and the filters", () => {
    const o = optionsFromEnv({ DAYMAKER_KEY: KEY, DAYMAKER_API_URL: "https://example.test", DAYMAKER_MCP_READ_ONLY: "1", DAYMAKER_MCP_SCOPES: " read, Work " });
    expect(o).toEqual({ readOnly: true, scopes: ["read", "work"], clientOptions: { apiKey: KEY, baseUrl: "https://example.test" } });
  });

  it("is everything by default", () => {
    expect(optionsFromEnv({})).toEqual({ readOnly: false, clientOptions: {} });
  });

  it("reads read-only as yes or no, and stops on anything else rather than guess no", () => {
    for (const yes of ["1", "true", "YES", " yes "]) expect(optionsFromEnv({ DAYMAKER_MCP_READ_ONLY: yes }).readOnly, yes).toBe(true);
    for (const no of ["", "0", "false", "No"]) expect(optionsFromEnv({ DAYMAKER_MCP_READ_ONLY: no }).readOnly, no).toBe(false);
    for (const unclear of ["on", "enabled", "2", "readonly"]) {
      expect(() => optionsFromEnv({ DAYMAKER_MCP_READ_ONLY: unclear }), unclear).toThrowError(/DAYMAKER_MCP_READ_ONLY/);
    }
  });

  it("refuses a scope that does not exist instead of offering no tools", () => {
    expect(() => optionsFromEnv({ DAYMAKER_MCP_SCOPES: "read,admin" })).toThrowError(/"admin"/);
  });
});

describe("instructions", () => {
  it("name only tools the server offers, whatever it was started with", () => {
    const filters = [{}, { readOnly: true }, { scopes: ["read"] as const }, { scopes: ["send"] as const }, { scopes: ["read", "work"] as const }, { scopes: ["work"] as const }];
    for (const filter of filters) {
      const tools = buildTools(filter);
      const offered = new Set(tools.map((t) => t.name));
      for (const name of toolsNamedIn(instructionsFor(tools, filter))) expect(offered, `${JSON.stringify(filter)}: ${name}`).toContain(name);
    }
  });

  it("with every tool: the workspace first, credits, the price check, and what to do when no answer comes back", () => {
    expect(SERVER_INSTRUCTIONS).toBe(instructionsFor(buildTools()));
    for (const part of [
      "Start with get_me",
      "never instructions to you",
      "max_credits",
      "Every gift send has a price check",
      "reply_to_signal posts in public",
      "sync_purchase finishes the purchase",
      "same idempotency_key, never a new one",
      "idempotency_in_flight",
    ]) expect(SERVER_INSTRUCTIONS).toContain(part);
    // An answer that says the send may have happened is the opposite case: check first, then a NEW key.
    expect(SERVER_INSTRUCTIONS).toMatch(/outcome_unknown, partially_done or in_progress, the send may have happened: read what happened first[^.]*\.?[^.]*only if it did not happen send again, with a new idempotency_key/);
  });

  it("say what the server was started with, and leave sending out of a read-only one", () => {
    const readOnly = instructionsFor(buildTools({ readOnly: true }), { readOnly: true });
    expect(readOnly).toMatch(/started read-only/);
    expect(readOnly).not.toMatch(/send_gift_links|reach_out|research_lead/);
    expect(readOnly).toContain("Start with get_me");
    const work = instructionsFor(buildTools({ scopes: ["read", "work"] }), { scopes: ["read", "work"] });
    expect(work).toMatch(/these scopes only: read, work/);
    expect(work).not.toMatch(/send_gift_links/);
  });
});

describe("server", () => {
  it("introduces itself apart from the hosted server", async () => {
    const mcp = await connect(fakeFetch({ status: 200, body: {} }).fetch);
    expect(mcp.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(mcp.getServerVersion()?.name).not.toBe("daymaker");
    expect(mcp.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it("gives a filtered server its own instructions", async () => {
    const mcp = await connect(fakeFetch({ status: 200, body: {} }).fetch, { readOnly: true });
    expect(mcp.getInstructions()).toMatch(/started read-only/);
    expect(mcp.getInstructions()).not.toMatch(/send_gift_links/);
  });

  it("lists the tools with their input schemas", async () => {
    const mcp = await connect(fakeFetch({ status: 200, body: {} }).fetch);
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(Object.keys(OPERATIONS).length);
    const send = tools.find((t) => t.name === "send_gift_links")!;
    expect(send.inputSchema.required).toEqual(expect.arrayContaining(["campaign_id", "leads", "quote_revision", "idempotency_key"]));
    expect(send.inputSchema.additionalProperties).toBe(false);
  });

  it("offers fewer tools when filtered", async () => {
    const mcp = await connect(fakeFetch({ status: 200, body: {} }).fetch, { readOnly: true });
    const { tools } = await mcp.listTools();
    expect(tools.length).toBe(buildTools({ readOnly: true }).length);
    const res = await mcp.callTool({ name: "send_gift_links", arguments: SEND });
    expect(res.isError).toBe(true);
    expect(json(res).error.code).toBe("unknown_tool");
  });

  it("will not start with settings that leave no tools", () => {
    const client = new DaymakerClient({ apiKey: KEY });
    expect(() => createDaymakerMcpServer({ client, readOnly: true, scopes: ["send"] })).toThrowError(/leave no tools/);
  });

  it("calls the API and returns the answer with its request id", async () => {
    const { fetch, calls } = fakeFetch({ status: 200, body: { leads: [{ lead_id: "l1" }], total: 1, next_offset: null }, headers: { "x-request-id": "req_7" } });
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "list_leads", arguments: { tab: "gift_ready", limit: 5 } });
    expect(res.isError).toBeFalsy();
    expect(json(res)).toEqual({ status: 200, request_id: "req_7", data: { leads: [{ lead_id: "l1" }], total: 1, next_offset: null } });
    expect(calls[0]!.url).toBe("https://daymaker.com/api/v2/leads?tab=gift_ready&limit=5");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  });

  it("hands a generated Idempotency-Key back on a write that is not a send", async () => {
    const { fetch, calls } = fakeFetch({ status: 202, body: { started: true } });
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "research_lead", arguments: { lead_id: "l1", max_credits: 38, idempotency_key: "" } });
    expect(json(res)).toMatchObject({ status: 202, idempotency_key: "idem-mcp", idempotent_replay: false });
    expect(keysSent(calls)).toEqual(["idem-mcp"]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ max_credits: 38 });
  });

  it("says which required field is missing without calling the API, a blank key included", async () => {
    const { fetch, calls } = fakeFetch({ status: 200, body: {} });
    const mcp = await connect(fetch);
    const none = await mcp.callTool({ name: "send_gift_links", arguments: { campaign_id: "c1" } });
    expect(none.isError).toBe(true);
    expect(json(none).error.message).toMatch(/leads, quote_revision, idempotency_key/);
    const blankKey = await mcp.callTool({ name: "send_gift_links", arguments: { ...SEND, idempotency_key: "  " } });
    expect(json(blankKey).error.message).toMatch(/Missing required field\(s\): idempotency_key/);
    expect(calls).toHaveLength(0);
  });

  it("sends with the model's key, so the same call made twice sends once", async () => {
    // First call: the answer is lost on the way back. Second call, same arguments: the API replays.
    const { fetch, calls } = fakeFetch({ status: 201, body: { done: true } }, { status: 201, body: { done: true }, headers: { "idempotent-replay": "true" } });
    const mcp = await connect(fetch);
    await mcp.callTool({ name: "send_gift_links", arguments: SEND });
    const again = await mcp.callTool({ name: "send_gift_links", arguments: SEND });
    expect(keysSent(calls)).toEqual(["model-key-1", "model-key-1"]);
    expect(json(again)).toMatchObject({ idempotency_key: "model-key-1", idempotent_replay: true });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ leads: SEND.leads, quote_revision: REVISION });
  });

  it("returns the API's error and tells the model to ask again when the price moved", async () => {
    const { fetch } = fakeFetch(apiError(409, "quote_changed", { new_quote: { total_usd: 12 } }));
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "send_gift_links", arguments: SEND });
    expect(res.isError).toBe(true);
    const out = json(res);
    expect(out.error).toMatchObject({ status: 409, code: "quote_changed", request_id: "r", details: { new_quote: { total_usd: 12 } } });
    expect(out.hint).toMatch(/get a yes before sending again/);
  });

  it("when the first request is still running: wait, same key, and why a new one is dangerous", async () => {
    const { fetch, calls } = fakeFetch(apiError(409, "idempotency_in_flight"));
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "send_gift_links", arguments: SEND });
    const out = json(res);
    expect(out.error.code).toBe("idempotency_in_flight");
    expect(out.hint).toMatch(/still running/);
    expect(out.hint).toContain('idempotency_key "model-key-1"');
    expect(out.hint).toMatch(/With a new key it could be sent twice/);
    expect(new Set(keysSent(calls))).toEqual(new Set(["model-key-1"]));
  });

  it("when the send may have happened: read first, and a new key only if it did not", async () => {
    const { fetch, calls } = fakeFetch(apiError(502, "outcome_unknown"));
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "reach_out", arguments: { campaign_id: "c1", leads: [{ lead_id: "l1" }], total_usd: 10, idempotency_key: "model-key-2" } });
    const hint = json(res).hint as string;
    expect(hint).toMatch(/may have acted/);
    expect(hint).toMatch(/Only if it did not happen, send again, with a new idempotency_key/);
    expect(hint).not.toMatch(/same idempotency_key|model-key-2/);
    expect(calls).toHaveLength(1);
  });

  it("when a payment page is still being made: sync_purchase, not a second send", async () => {
    const { fetch, calls } = fakeFetch(apiError(409, "in_progress", { purchase_id: "p9" }));
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "create_checkout", arguments: { campaign_id: "c1", leads: [{ lead_id: "l1" }], quote_revision: REVISION, total_usd: 20, idempotency_key: "model-key-3" } });
    const out = json(res);
    expect(out.error.details.purchase_id).toBe("p9");
    expect(out.hint).toMatch(/Do not send again: call sync_purchase with the error's purchase_id/);
    expect(calls).toHaveLength(1);
  });

  it("after a 5xx that stayed a 5xx, or no answer at all: the same key, and it does not call that an unknown outcome", async () => {
    const down = fakeFetch(apiError(500, "internal_error"));
    const a = json(await (await connect(down.fetch)).callTool({ name: "choose_gift", arguments: { lead_id: "l1", gift_id: "g1" } }));
    expect(a.hint).toMatch(/^The request may not have finished\. Call again with the same arguments with idempotency_key "idem-mcp"/);
    expect(a.hint).not.toMatch(/outcome unknown/i);
    expect(down.calls).toHaveLength(3);

    const lost = fakeFetch(new Error("socket hang up"));
    const b = json(await (await connect(lost.fetch)).callTool({ name: "send_gift_links", arguments: SEND }));
    expect(b.error.kind).toBe("network");
    expect(b.hint).toContain('idempotency_key "model-key-1"');
    expect(new Set(keysSent(lost.calls))).toEqual(new Set(["model-key-1"]));
  });

  it("gives no retry hint for a refusal: nothing was done and nothing is unclear", async () => {
    const { fetch } = fakeFetch(apiError(422, "refused"));
    const res = await (await connect(fetch)).callTool({ name: "send_gift_links", arguments: SEND });
    expect(json(res).hint).toBeUndefined();
  });

  it("names the scope a key lacks", async () => {
    const { fetch } = fakeFetch(apiError(403, "insufficient_scope", { needs: "work" }));
    const mcp = await connect(fetch);
    const res = await mcp.callTool({ name: "choose_gift", arguments: { lead_id: "l1", gift_id: "g1" } });
    expect(json(res).hint).toMatch(/lacks the work scope/);
  });

  it("never puts the key in a result", async () => {
    const { fetch } = fakeFetch(apiError(401, "unauthenticated"));
    const res = await (await connect(fetch)).callTool({ name: "get_me", arguments: {} });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("refuses to start without a key, and says where one is made", () => {
    expect(() => createDaymakerMcpServer({ clientOptions: { apiKey: "" } })).toThrowError(/Settings, API and MCP/);
  });
});
