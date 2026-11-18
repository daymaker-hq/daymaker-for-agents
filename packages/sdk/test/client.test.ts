import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaymakerClient, DaymakerError, OPERATIONS, isDaymakerError, resolveUrls } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const KEY = "dmk_live_" + "x".repeat(40);
const REVISION = "a".repeat(64);
const GIFT_LINKS = { campaign_id: "c1", leads: [{ lead_id: "l1", how: "email_link" as const }], quote_revision: REVISION };

function client(...replies: Parameters<typeof mockFetch>) {
  const { fetch, calls } = mockFetch(...replies);
  const sleeps: number[] = [];
  const dm = new DaymakerClient({
    apiKey: KEY,
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    idempotencyKeyFactory: () => "generated-key",
  });
  return { dm, calls, sleeps };
}

async function caught(p: Promise<unknown>): Promise<DaymakerError> {
  try {
    await p;
  } catch (e) {
    if (isDaymakerError(e)) return e;
    throw e;
  }
  throw new Error("expected the call to fail");
}

const apiError = (status: number, code: string, headers?: Record<string, string>) => ({
  status,
  body: { error: { code, message: "x", request_id: "r" } },
  ...(headers ? { headers } : {}),
});

afterEach(() => vi.unstubAllEnvs());

describe("the key", () => {
  it("refuses to start without one", () => {
    vi.stubEnv("DAYMAKER_KEY", "");
    expect(() => new DaymakerClient()).toThrowError(/No Daymaker API key/);
  });

  it("reads DAYMAKER_KEY", async () => {
    vi.stubEnv("DAYMAKER_KEY", KEY);
    const { fetch, calls } = mockFetch({ body: { you: {} } });
    await new DaymakerClient({ fetch }).getMe();
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("says where a Cold Caked Cake API key belongs instead of sending it", () => {
    for (const k of ["dm_live_abc", "dm_test_abc"]) {
      let err: unknown;
      try {
        new DaymakerClient({ apiKey: k });
      } catch (e) {
        err = e;
      }
      expect(isDaymakerError(err) && err.code).toBe("wrong_key_family");
      expect((err as Error).message).toMatch(/api\/v1\/partner/);
    }
  });

  it("refuses a key with a line break or a space inside, without repeating it", () => {
    for (const bad of ["dmk_live_abc\ndef", "dmk_live_abc def", "dmk_live_abc\u0000"]) {
      let err: unknown;
      try {
        new DaymakerClient({ apiKey: bad });
      } catch (e) {
        err = e;
      }
      expect(isDaymakerError(err) && err.code).toBe("invalid_api_key");
      expect((err as Error).message).not.toContain("dmk_live_abc");
      expect(JSON.stringify((err as DaymakerError).toJSON())).not.toContain("dmk_live_abc");
    }
  });

  it("knows a staff test key from a customer key", () => {
    expect(new DaymakerClient({ apiKey: KEY }).keyKind).toBe("live");
    expect(new DaymakerClient({ apiKey: "dmk_test_abc" }).keyKind).toBe("test");
    expect(new DaymakerClient({ apiKey: "something-else" }).keyKind).toBe("unknown");
  });

  it("cannot be replaced or doubled by a caller's header, however it is spelt", async () => {
    const { dm, calls } = client({ body: {} });
    await dm.chooseGift(
      { lead_id: "l1", gift_id: "g1" },
      { headers: { Authorization: "Bearer other", "Content-Type": "text/plain", "Idempotency-Key": "theirs", "X-Api-Key": "dmk_live_other", "X-Trace": "1" } },
    );
    const h = calls[0]!.headers;
    expect(h.authorization).toBe(`Bearer ${KEY}`);
    expect(h["content-type"]).toBe("application/json");
    expect(h["idempotency-key"]).toBe("generated-key");
    expect(h["x-api-key"]).toBeUndefined();
    expect(h["x-trace"]).toBe("1");
    // One of each: a second spelling would be joined to the first by the HTTP layer.
    expect(Object.keys(h).filter((k) => k.toLowerCase() === "authorization")).toHaveLength(1);
  });

  it("never shows in a printed client or in an error", async () => {
    const { dm } = client(apiError(401, "unauthenticated"));
    expect(JSON.stringify(dm)).not.toContain(KEY);
    expect(inspect(dm, { depth: 6, showHidden: true })).not.toContain(KEY);
    const err = await caught(dm.getMe());
    expect(JSON.stringify(err.toJSON())).not.toContain(KEY);
    expect(inspect(err, { depth: 6 })).not.toContain(KEY);
  });
});

describe("resolveUrls", () => {
  it("defaults to daymaker.com/api/v2", () => {
    expect(resolveUrls()).toEqual({
      origin: "https://daymaker.com",
      api: "https://daymaker.com/api/v2",
      openapi: "https://daymaker.com/api/v2/openapi.json",
      docs: "https://daymaker.com/api/v2/docs",
      mcp: "https://daymaker.com/mcp",
    });
  });

  it("takes an origin or the full base, with or without a trailing slash", () => {
    for (const base of ["https://example.test", "https://example.test/", "https://example.test/api/v2", "https://example.test/api/v2/"]) {
      expect(resolveUrls(base).api).toBe("https://example.test/api/v2");
    }
  });

  it("sends a key in the clear only to this computer", () => {
    expect(resolveUrls("http://localhost:3000").api).toBe("http://localhost:3000/api/v2");
    expect(resolveUrls("http://127.0.0.1:3000/api/v2").api).toBe("http://127.0.0.1:3000/api/v2");
    expect(resolveUrls("http://[::1]:3000").api).toBe("http://[::1]:3000/api/v2");
    expect(() => resolveUrls("http://example.test")).toThrowError(/must be https/);
    // A host that only looks like this computer.
    expect(() => resolveUrls("http://localhost@example.test")).toThrowError(/must be https/);
    expect(() => resolveUrls("http://localhost.example.test")).toThrowError(/must be https/);
    expect(() => resolveUrls("not a url")).toThrowError(/Not a URL/);
  });

  it("reads DAYMAKER_API_URL", () => {
    vi.stubEnv("DAYMAKER_API_URL", "https://example.test");
    expect(new DaymakerClient({ apiKey: KEY }).urls.api).toBe("https://example.test/api/v2");
  });
});

describe("the operation table", () => {
  // Read straight from the contract, not through the generator: `spec:check` only proves the table
  // is what the generator writes, this proves the generator read the contract right.
  const spec = JSON.parse(readFileSync(new URL("../../../spec/openapi.json", import.meta.url), "utf8"));
  const fromSpec: Record<string, { method: string; path: string; scope: string; idempotency: string; query: string[]; body: string[] }> = {};
  for (const [path, item] of Object.entries(spec.paths) as [string, Record<string, any>][]) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op) continue;
      const header = (op.parameters ?? []).find((p: any) => p.in === "header" && p.name === "Idempotency-Key");
      fromSpec[op.operationId] = {
        method: method.toUpperCase(),
        path,
        scope: op["x-scope"],
        idempotency: header ? (header.required ? "required" : "optional") : "none",
        query: (op.parameters ?? []).filter((p: any) => p.in === "query").map((p: any) => p.name),
        body: Object.keys(op.requestBody?.content?.["application/json"]?.schema?.properties ?? {}),
      };
    }
  }

  it("is the contract, operation for operation", () => {
    expect(Object.keys(OPERATIONS).sort()).toEqual(Object.keys(fromSpec).sort());
    for (const [id, want] of Object.entries(fromSpec)) {
      const op = OPERATIONS[id as keyof typeof OPERATIONS];
      expect({ method: op.method, path: op.path, scope: op.scope, idempotency: op.idempotency, query: op.queryParams.map((q) => q.name), body: [...op.bodyFields] }, id).toEqual(want);
    }
  });

  it("never calls a write without a key safe to send again", () => {
    for (const op of Object.values(OPERATIONS)) {
      const unkeyedWrite = op.scope !== "read" && op.idempotency === "none";
      if (unkeyedWrite) expect(op.retrySafe, op.operationId).toBe(false);
      if (op.method === "GET") expect(op.scope, op.operationId).toBe("read");
    }
    expect(OPERATIONS.syncPurchase).toMatchObject({ idempotency: "none", scope: "send", retrySafe: false });
    expect(OPERATIONS.quoteGiftLinks).toMatchObject({ method: "POST", idempotency: "none", scope: "read", retrySafe: true });
  });

  it("requires a key exactly where the API does: the sends", () => {
    const required = Object.values(OPERATIONS).filter((o) => o.idempotency === "required").map((o) => o.operationId).sort();
    expect(required).toEqual(["createCheckout", "createPurchaseCheckout", "reachOut", "replyToSignal", "sendGiftLinks"]);
    for (const id of required) expect(OPERATIONS[id as keyof typeof OPERATIONS].scope).toBe("send");
  });

  it("does not pass on advice meant for raw HTTP callers", () => {
    // The contract says to write a zone's + as %2B; the client encodes query values itself.
    expect(JSON.stringify(OPERATIONS)).not.toMatch(/%2B/i);
    expect(readFileSync(new URL("../../../spec/openapi.json", import.meta.url), "utf8")).toMatch(/%2B/);
  });
});

describe("building a request", () => {
  it("puts a read's fields in the query and sends no body and no Idempotency-Key", async () => {
    const { dm, calls } = client({ body: { leads: [], total: 0, next_offset: null } });
    await dm.listLeads({ tab: "gift_ready", limit: 50, search: "ada lovelace" });
    const c = calls[0]!;
    expect(c.method).toBe("GET");
    expect(c.url.origin + c.url.pathname).toBe("https://daymaker.com/api/v2/leads");
    expect(Object.fromEntries(c.url.searchParams)).toEqual({ tab: "gift_ready", limit: "50", search: "ada lovelace" });
    expect(c.body).toBeUndefined();
    expect(c.headers["idempotency-key"]).toBeUndefined();
    expect(c.headers["content-type"]).toBeUndefined();
    expect(c.headers["user-agent"]).toMatch(/^daymaker-sdk-js\//);
  });

  it("encodes a time zone's plus sign once", async () => {
    const { dm, calls } = client({ body: {} });
    await dm.listLeads({ updated_since: "2026-11-01T09:00:00+02:00" });
    expect(calls[0]!.url.search).toBe("?updated_since=2026-11-01T09%3A00%3A00%2B02%3A00");
    expect(calls[0]!.url.searchParams.get("updated_since")).toBe("2026-11-01T09:00:00+02:00");
  });

  it("writes booleans and numbers the way the API reads them", async () => {
    const { dm, calls } = client({ body: {} });
    await dm.listSignals({ only_new: true, offset: 0 });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ only_new: "true", offset: "0" });
  });

  it("escapes a path field and keeps it out of the body", async () => {
    const { dm, calls } = client({ body: {} });
    await dm.setGiftMessage({ lead_id: "a/b c", body: "Hello", subject: "Hi" });
    const c = calls[0]!;
    expect(c.method).toBe("PUT");
    expect(c.url.pathname).toBe("/api/v2/leads/a%2Fb%20c/gift-message");
    expect(c.body).toEqual({ body: "Hello", subject: "Hi" });
    expect(c.headers["content-type"]).toBe("application/json");
  });

  it("says which path field is missing before any request goes out", async () => {
    const { dm, calls } = client({ body: {} });
    const err = await caught(dm.call("getLead", {} as never));
    expect(err.kind).toBe("invalid_request");
    expect(err.message).toMatch(/lead_id/);
    expect(calls).toHaveLength(0);
  });

  it.each([".", ".."])("refuses %s as an id: the address would fold onto another one", async (id) => {
    const { dm, calls } = client({ body: {} });
    const err = await caught(dm.clearGift({ lead_id: id }));
    expect(err.code).toBe("validation_error");
    expect(calls).toHaveLength(0);
  });

  it("refuses a field a read does not have instead of dropping it", async () => {
    const { dm, calls } = client({ body: {} });
    const err = await caught(dm.call("getMe", { nope: 1 } as never));
    expect(err.code).toBe("validation_error");
    expect(err.message).toMatch(/nope/);
    expect(calls).toHaveLength(0);
  });

  it("sends an empty JSON object when every body field is optional", async () => {
    const { dm, calls } = client({ status: 202, body: { started: true } });
    await dm.researchLead({ lead_id: "l1" });
    expect(calls[0]!.body).toEqual({});
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
  });

  it("sends a DELETE with a key and no body", async () => {
    const { dm, calls } = client({ body: {} });
    await dm.clearGift({ lead_id: "l1" });
    const c = calls[0]!;
    expect(c.method).toBe("DELETE");
    expect(c.body).toBeUndefined();
    expect(c.headers["idempotency-key"]).toBe("generated-key");
  });

  it("never follows a redirect", async () => {
    let seen: RequestInit | undefined;
    const dm = new DaymakerClient({
      apiKey: KEY,
      fetch: (async (_url: unknown, init?: RequestInit) => {
        seen = init;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await dm.getMe();
    expect(seen?.redirect).toBe("error");
  });
});

describe("Idempotency-Key", () => {
  it("is generated for a write and handed back with the answer", async () => {
    const { dm, calls } = client({ status: 202, body: { started: true }, headers: { "x-request-id": "req_1" } });
    const res = await dm.request("researchLead", { lead_id: "l1", max_credits: 38 });
    expect(calls[0]!.headers["idempotency-key"]).toBe("generated-key");
    expect(calls[0]!.body).toEqual({ max_credits: 38 });
    expect(res).toMatchObject({ status: 202, requestId: "req_1", idempotencyKey: "generated-key", idempotentReplay: false, attempts: 1 });
  });

  it("uses the caller's own key, and the option wins over the input", async () => {
    const { dm, calls } = client({ body: {} });
    await dm.chooseGift({ lead_id: "l1", gift_id: "g1", idempotency_key: "mine" });
    expect(calls[0]!.headers["idempotency-key"]).toBe("mine");
    expect(calls[0]!.body).toEqual({ gift_id: "g1" });
    await dm.chooseGift({ lead_id: "l1", gift_id: "g1", idempotency_key: "mine" }, { idempotencyKey: "option" });
    expect(calls[1]!.headers["idempotency-key"]).toBe("option");
  });

  it.each(["", "   ", null])("reads a blank key (%j) as none given, and makes one", async (blank) => {
    // An empty header would switch the API's protection off while the client still retried.
    const { dm, calls } = client(new Error("socket hang up"), { status: 201, body: {} });
    const res = await dm.request("createCampaign", { name: "Q4", idempotency_key: blank } as never);
    expect(calls.map((c) => c.headers["idempotency-key"])).toEqual(["generated-key", "generated-key"]);
    expect(calls[0]!.body).toEqual({ name: "Q4" });
    expect(res.idempotencyKey).toBe("generated-key");
  });

  it("refuses a key the API would not take", async () => {
    const { dm, calls } = client({ body: {} });
    for (const bad of ["k".repeat(256), "line\nbreak", "caf" + String.fromCharCode(0xe9)]) {
      const err = await caught(dm.chooseGift({ lead_id: "l1", gift_id: "g1", idempotency_key: bad }));
      expect(err.message).toMatch(/1 to 255 visible characters/);
    }
    expect(calls).toHaveLength(0);
  });

  it("is refused on an operation that takes none", async () => {
    const { dm, calls } = client({ body: {} });
    const err = await caught(dm.call("quoteGiftLinks", { campaign_id: "c1", leads: [], idempotency_key: "k" } as never));
    expect(err.message).toMatch(/takes no Idempotency-Key/);
    expect(calls).toHaveLength(0);
  });

  it("reports a replayed answer", async () => {
    const { dm } = client({ status: 201, body: { done: true }, headers: { "idempotent-replay": "true" } });
    const res = await dm.request("sendGiftLinks", { ...GIFT_LINKS, leads: [{ lead_id: "l1", how: "share_link" }] });
    expect(res.idempotentReplay).toBe(true);
  });
});

describe("errors", () => {
  it("carries the API's envelope, with the fields its code brings along", async () => {
    const { dm } = client({
      status: 403,
      body: { error: { code: "insufficient_scope", message: "This key cannot send.", request_id: "req_9", needs: "send" } },
    });
    const err = await caught(dm.reachOut({ campaign_id: "c1", leads: [{ lead_id: "l1" }], total_usd: 0 }));
    expect(err).toMatchObject({ kind: "api", status: 403, code: "insufficient_scope", requestId: "req_9", message: "This key cannot send." });
    expect(err.details.needs).toBe("send");
    expect(err.operationId).toBe("reachOut");
    expect(err.idempotencyKey).toBe("generated-key");
    expect(err.toJSON()).toMatchObject({ code: "insufficient_scope", details: { needs: "send" } });
  });

  it("hands over the new quote when the price moved, without retrying", async () => {
    const { dm, calls } = client({
      status: 409,
      body: { error: { code: "quote_changed", message: "The price moved.", request_id: "r", new_quote: { quote_revision: "b".repeat(64) } } },
    });
    const err = await caught(dm.sendGiftLinks(GIFT_LINKS));
    expect(err.code).toBe("quote_changed");
    expect(err.details.new_quote).toEqual({ quote_revision: "b".repeat(64) });
    expect(calls).toHaveLength(1);
  });

  it("lists the fields a validation error names", async () => {
    const { dm } = client({
      status: 400,
      body: { error: { code: "validation_error", message: "Check the fields.", request_id: "r", fields: [{ field: "people", problem: "is required" }] } },
    });
    const err = await caught(dm.addLeads({ people: [] }));
    expect(err.fields).toEqual([{ field: "people", problem: "is required" }]);
  });

  it("keeps a failed answer that is not the envelope", async () => {
    const { dm } = client({ status: 418, body: "teapot" });
    const err = await caught(dm.getMe());
    expect(err.code).toBe("http_418");
    expect(err.message).toBe("teapot");
  });

  it("does not take a page from another server for a result", async () => {
    // A wrong DAYMAKER_API_URL or a proxy answering 200 with HTML.
    const dm = new DaymakerClient({ apiKey: KEY, fetch: (async () => new Response("<html>hello</html>", { status: 200 })) as typeof fetch });
    const err = await caught(dm.getMe());
    expect(err).toMatchObject({ kind: "api", status: 200, code: "invalid_response" });
    const list = new DaymakerClient({ apiKey: KEY, fetch: (async () => new Response("[1,2]", { status: 200 })) as typeof fetch });
    expect((await caught(list.getMe())).code).toBe("invalid_response");
  });
});

describe("retries", () => {
  it("sends a read again after a 5xx", async () => {
    const { dm, calls, sleeps } = client(apiError(503, "service_unavailable"), { body: { ok: 1 } });
    const res = await dm.request("getMe", {});
    expect(res.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it("sends a keyed write again with the same key", async () => {
    const { dm, calls } = client(apiError(500, "internal_error"), { status: 201, body: { done: true } });
    await dm.sendGiftLinks(GIFT_LINKS);
    expect(calls.map((c) => c.headers["idempotency-key"])).toEqual(["generated-key", "generated-key"]);
  });

  it("never sends a write without a key again after a 5xx", async () => {
    const { dm, calls } = client(apiError(502, "bad_gateway"));
    const err = await caught(dm.syncPurchase({ purchase_id: "p1" }));
    expect(err.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("sends a price check again: it changes nothing", async () => {
    const { dm, calls } = client({ status: 500, body: {} }, { body: { quote: { quote_revision: REVISION } } });
    const out = await dm.quoteGiftLinks({ campaign_id: "c1", leads: [{ lead_id: "l1", how: "share_link" }] });
    expect(out.quote.quote_revision).toBe(REVISION);
    expect(calls).toHaveLength(2);
  });

  it.each(["outcome_unknown", "partially_done", "in_progress"])("never sends again after %s: the request may have acted", async (code) => {
    const { dm, calls } = client(apiError(502, code), { status: 201, body: {} });
    const err = await caught(dm.reachOut({ campaign_id: "c1", leads: [{ lead_id: "l1" }], total_usd: 10 }));
    expect(err.code).toBe(code);
    expect(err.checkBeforeRetry).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("waits out a short 429 and gives a long one, or one with no wait named, to the caller", async () => {
    const short = client(apiError(429, "rate_limited", { "retry-after": "2" }), { body: {} });
    await short.dm.getMe();
    expect(short.sleeps).toEqual([2000]);

    const long = client(apiError(429, "daily_limit", { "retry-after": "3600" }), { body: {} });
    const err = await caught(long.dm.getMe());
    expect(err).toMatchObject({ status: 429, retryAfterMs: 3_600_000 });
    expect(long.calls).toHaveLength(1);

    const bare = client(apiError(429, "rate_limited"), { body: {} });
    expect((await caught(bare.dm.getMe())).status).toBe(429);
    expect(bare.calls).toHaveLength(1);
  });

  it("waits out a 429 on a write without a key too: it was refused before any work", async () => {
    const { dm, calls } = client(apiError(429, "rate_limited", { "retry-after": "1" }), { body: {} });
    await dm.syncPurchase({ purchase_id: "p1" });
    expect(calls).toHaveLength(2);
  });

  it("does not wait out a pause longer than its cap", async () => {
    const { dm, calls } = client(apiError(503, "paused", { "retry-after": "600" }), { body: {} });
    expect((await caught(dm.getMe())).code).toBe("paused");
    expect(calls).toHaveLength(1);
  });

  it("waits while the first request with the same key is still running", async () => {
    const { dm, calls, sleeps } = client(apiError(409, "idempotency_in_flight", { "retry-after": "1" }), { status: 201, body: { done: true } });
    await dm.reachOut({ campaign_id: "c1", leads: [{ lead_id: "l1" }], total_usd: 10 });
    expect(sleeps).toEqual([1000]);
    expect(calls.map((c) => c.headers["idempotency-key"])).toEqual(["generated-key", "generated-key"]);
  });

  it("gives up on a request still running with the key in the error, so the caller can go on waiting", async () => {
    const { dm, calls, sleeps } = client(apiError(409, "idempotency_in_flight"));
    const err = await caught(dm.sendGiftLinks(GIFT_LINKS));
    expect(err).toMatchObject({ code: "idempotency_in_flight", idempotencyKey: "generated-key", attempts: 3 });
    expect(calls).toHaveLength(3);
    // No Retry-After: it still waits between tries.
    expect(sleeps).toHaveLength(2);
    expect(new Set(calls.map((c) => c.headers["idempotency-key"]))).toEqual(new Set(["generated-key"]));
  });

  it("sends again after a network error only where that is safe", async () => {
    const safe = client(new Error("socket hang up"), { body: {} });
    await safe.dm.listCampaigns();
    expect(safe.calls).toHaveLength(2);

    const keyed = client(new Error("socket hang up"), { status: 201, body: {} });
    await keyed.dm.sendGiftLinks(GIFT_LINKS);
    expect(keyed.calls.map((c) => c.headers["idempotency-key"])).toEqual(["generated-key", "generated-key"]);

    const unsafe = client(new Error("socket hang up"), { body: {} });
    const err = await caught(unsafe.dm.syncPurchase({ purchase_id: "p1" }));
    expect(err.kind).toBe("network");
    expect(unsafe.calls).toHaveLength(1);
  });

  it("treats an answer that breaks while it is read as a lost answer: same key, and the key in the error", async () => {
    // The 201's headers arrived, so the send happened; the body did not.
    let n = 0;
    const keys: (string | undefined)[] = [];
    const broken = (async (_url: unknown, init?: RequestInit) => {
      n++;
      keys.push((init?.headers as Record<string, string>)["idempotency-key"]);
      const res = new Response("{}", { status: 201 });
      Object.defineProperty(res, "text", { value: async () => { throw new TypeError("terminated"); } });
      return res;
    }) as typeof fetch;
    const dm = new DaymakerClient({ apiKey: KEY, fetch: broken, sleep: async () => {}, idempotencyKeyFactory: () => "generated-key" });
    const err = await caught(dm.sendGiftLinks(GIFT_LINKS));
    expect(err).toMatchObject({ kind: "network", idempotencyKey: "generated-key", attempts: 3 });
    expect(n).toBe(3);
    expect(keys).toEqual(["generated-key", "generated-key", "generated-key"]);
  });

  it("times an attempt out, says so, and keeps the key", async () => {
    let n = 0;
    const hang = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        n++;
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      })) as typeof fetch;
    const dm = new DaymakerClient({ apiKey: KEY, fetch: hang, sleep: async () => {}, timeoutMs: 15, maxRetries: 1, idempotencyKeyFactory: () => "generated-key" });
    const err = await caught(dm.sendGiftLinks(GIFT_LINKS));
    expect(err).toMatchObject({ kind: "timeout", code: "timeout", idempotencyKey: "generated-key", attempts: 2 });
    expect(n).toBe(2);
  });

  it("stops at once when the caller aborts, and throws the caller's own reason", async () => {
    const ac = new AbortController();
    const hang = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        ac.abort(new Error("stopped by the caller"));
      })) as typeof fetch;
    const dm = new DaymakerClient({ apiKey: KEY, fetch: hang, sleep: async () => {} });
    await expect(dm.getMe({}, { signal: ac.signal })).rejects.toThrowError("stopped by the caller");
  });

  it("gives up after maxRetries", async () => {
    const { dm, calls } = client({ status: 500, body: {} });
    const err = await caught(dm.getMe({}, { maxRetries: 1 }));
    expect(err.attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });
});

describe("pages", () => {
  it("follows next_offset to the end", async () => {
    const { dm, calls } = client(
      { body: { leads: [{ lead_id: "a" }], total: 3, next_offset: 1 } },
      { body: { leads: [{ lead_id: "b" }], total: 3, next_offset: 2 } },
      { body: { leads: [{ lead_id: "c" }], total: 3, next_offset: null } },
    );
    const ids: string[] = [];
    for await (const page of dm.pages("listLeads", { limit: 1 })) ids.push(...page.leads.map((l) => l.lead_id));
    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "1", "2"]);
  });

  it("stops when a next page does not move forward", async () => {
    const { dm, calls } = client({ body: { leads: [], total: 9, next_offset: 0 } });
    let n = 0;
    for await (const _ of dm.pages("listLeads", {})) n++;
    expect(n).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("refuses an operation that is not a list", async () => {
    const { dm } = client({ body: {} });
    await expect(async () => {
      for await (const _ of dm.pages("getMe" as never, {} as never)) void _;
    }).rejects.toThrowError(/not a list/);
  });
});
