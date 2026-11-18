import { randomUUID } from "node:crypto";
import { CHECK_BEFORE_RETRY, DaymakerError, errorFromResponse, parseRetryAfter } from "./errors.js";
import { OPERATIONS, type OperationId } from "./generated/operations.js";
import type { OperationSpec } from "./operation-spec.js";
import type {
  DaymakerOperations,
  DaymakerResponse,
  JsonObject,
  OperationInput,
  OperationOutput,
  PagedOperationId,
  RequestOptions,
} from "./types.js";
import { SDK_VERSION } from "./version.js";

export const DEFAULT_API_URL = "https://daymaker.com/api/v2";

export interface DaymakerClientOptions {
  /** A `dmk_live_...` key, made in Daymaker under Settings, API and MCP. Defaults to `process.env.DAYMAKER_KEY`. */
  apiKey?: string;
  /** Base URL of the API. Defaults to `DAYMAKER_API_URL`, then https://daymaker.com/api/v2. An origin alone gets `/api/v2` added. */
  baseUrl?: string;
  /** Retries after a timeout, a network error, a 5xx or a short 429. Default 2. */
  maxRetries?: number;
  /** Per-attempt timeout. Default 120 s: a send to many people takes a while. */
  timeoutMs?: number;
  /** Longest `Retry-After` the client waits out before it gives the error to you. Default 30 s. */
  maxRetryDelayMs?: number;
  fetch?: typeof fetch;
  userAgent?: string;
  idempotencyKeyFactory?: () => string;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ResolvedUrls {
  origin: string;
  /** The API base, `<origin>/api/v2`. */
  api: string;
  openapi: string;
  docs: string;
  /** The hosted MCP server, `<origin>/mcp`. It takes a sign-in, not an API key. */
  mcp: string;
}

/** Accepts an origin or `<origin>/api/v2`, and derives the rest. */
export function resolveUrls(base: string = DEFAULT_API_URL): ResolvedUrls {
  let url: URL;
  try {
    url = new URL(base.trim().replace(/\/+$/, ""));
  } catch {
    throw new DaymakerError({ kind: "invalid_request", code: "invalid_base_url", message: `Not a URL: ${base}` });
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new DaymakerError({
      kind: "invalid_request",
      code: "invalid_base_url",
      message: `The Daymaker API URL must be https (http only for this computer), so a key is never sent in the clear: ${base}`,
    });
  }
  const prefix = url.pathname.replace(/\/api\/v2$/, "").replace(/\/+$/, "");
  const origin = `${url.origin}${prefix}`;
  return {
    origin,
    api: `${origin}/api/v2`,
    openapi: `${origin}/api/v2/openapi.json`,
    docs: `${origin}/api/v2/docs`,
    mcp: `${origin}/mcp`,
  };
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const env = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] || undefined : undefined;

/** Characters a header value can carry and a person can see: printable ASCII. */
const VISIBLE = /^[\x21-\x7e]+$/;
const VISIBLE_WITH_SPACES = /^[\x20-\x7e]+$/;

type ClientSettings = Required<Pick<DaymakerClientOptions, "maxRetries" | "timeoutMs" | "maxRetryDelayMs" | "userAgent">> &
  Pick<DaymakerClientOptions, "fetch" | "idempotencyKeyFactory" | "sleep">;

export interface DaymakerClient extends DaymakerOperations {}

/**
 * Typed client for the Daymaker API.
 *
 * ```ts
 * const dm = new DaymakerClient({ apiKey: process.env.DAYMAKER_KEY });
 * const me = await dm.getMe();
 * const { leads } = await dm.listLeads({ tab: "gift_ready" });
 * ```
 *
 * Every operation in the published contract is a method named by its
 * `operationId`; `call(operationId, input)` and `request(...)` reach the same
 * table generically. A key acts as the person who made it: their role, their
 * team, their credits and their limits, exactly as in the Daymaker app.
 */
export class DaymakerClient {
  readonly urls: ResolvedUrls;
  /** `test` for a staff `dmk_test_` key: read-only, it cannot change data, spend credits or send. */
  readonly keyKind: "live" | "test" | "unknown";
  // A real private field: the key never shows in console.log(client) or JSON.stringify(client).
  readonly #apiKey: string;
  private readonly opts: ClientSettings;

  constructor(options: DaymakerClientOptions = {}) {
    const apiKey = (options.apiKey ?? env("DAYMAKER_KEY") ?? "").trim();
    if (!apiKey) {
      throw new DaymakerError({
        kind: "invalid_request",
        code: "missing_api_key",
        message: "No Daymaker API key. Pass apiKey or set DAYMAKER_KEY to a dmk_live_ key, made in Daymaker under Settings, API and MCP.",
      });
    }
    if (!VISIBLE.test(apiKey)) {
      // Said without the key itself: an error message ends up in logs.
      throw new DaymakerError({
        kind: "invalid_request",
        code: "invalid_api_key",
        message: "The Daymaker API key has a space, a line break or another character a key never has. Copy it again from Settings, API and MCP.",
      });
    }
    if (/^dm_(live|test)_/.test(apiKey)) {
      throw new DaymakerError({
        kind: "invalid_request",
        code: "wrong_key_family",
        message:
          "This is a Cold Caked Cake API key (dm_live_ or dm_test_). It belongs at https://daymaker.com/api/v1/partner. The Daymaker API takes dmk_live_ and dmk_test_ keys, made in Daymaker under Settings, API and MCP.",
      });
    }
    this.#apiKey = apiKey;
    this.keyKind = apiKey.startsWith("dmk_test_") ? "test" : apiKey.startsWith("dmk_live_") ? "live" : "unknown";
    this.urls = resolveUrls(options.baseUrl ?? env("DAYMAKER_API_URL") ?? DEFAULT_API_URL);
    this.opts = {
      maxRetries: options.maxRetries ?? 2,
      timeoutMs: options.timeoutMs ?? 120_000,
      maxRetryDelayMs: options.maxRetryDelayMs ?? 30_000,
      userAgent: options.userAgent ?? `daymaker-sdk-js/${SDK_VERSION}`,
      fetch: options.fetch,
      idempotencyKeyFactory: options.idempotencyKeyFactory,
      sleep: options.sleep,
    };
    for (const id of Object.keys(OPERATIONS) as OperationId[]) {
      Object.defineProperty(this, id, {
        value: (input?: JsonObject, o?: RequestOptions) => this.call(id, (input ?? {}) as never, o),
        enumerable: false,
      });
    }
  }

  /** Calls one operation and returns its body. */
  async call<K extends OperationId>(
    operationId: K,
    input: OperationInput<K>,
    options?: RequestOptions,
  ): Promise<OperationOutput<K>> {
    return (await this.request(operationId, input, options)).data;
  }

  /**
   * Reads a list page by page, following `next_offset` until the API says
   * there is no next page. Yields each page's whole answer.
   *
   * ```ts
   * for await (const page of dm.pages("listLeads", { tab: "researched", limit: 100 })) {
   *   for (const lead of page.leads ?? []) console.log(lead.name);
   * }
   * ```
   */
  async *pages<K extends PagedOperationId>(
    operationId: K,
    input: OperationInput<K>,
    options?: RequestOptions,
  ): AsyncGenerator<OperationOutput<K>, void, void> {
    const spec = OPERATIONS[operationId] as OperationSpec | undefined;
    if (!spec?.queryParams.some((q) => q.name === "offset")) {
      throw new DaymakerError({ kind: "invalid_request", message: `${String(operationId)} is not a list with an offset` });
    }
    let offset = Number((input as JsonObject).offset ?? 0);
    for (;;) {
      const page = await this.call(operationId, { ...(input as JsonObject), offset } as never, options);
      yield page;
      const next = (page as JsonObject).next_offset;
      // A next page that does not move forward would loop for ever.
      if (typeof next !== "number" || next <= offset) return;
      offset = next;
    }
  }

  /** Calls one operation and returns the body with its status, request id and idempotency details. */
  async request<K extends OperationId>(
    operationId: K,
    input: OperationInput<K>,
    options: RequestOptions = {},
  ): Promise<DaymakerResponse<OperationOutput<K>>> {
    const spec = OPERATIONS[operationId] as OperationSpec | undefined;
    if (!spec) {
      throw new DaymakerError({ kind: "invalid_request", message: `Unknown operation: ${String(operationId)}` });
    }
    const built = this.build(spec, { ...(input as JsonObject) }, options);
    const maxRetries = Math.max(0, options.maxRetries ?? this.opts.maxRetries);
    const doFetch = this.opts.fetch ?? globalThis.fetch;
    const sleep = this.opts.sleep ?? sleepReal;
    const ctx = { operationId: spec.operationId, idempotencyKey: built.idempotencyKey };

    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? this.opts.timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let res: Response;
      let data: unknown;
      try {
        // A redirect would carry the body and the Idempotency-Key to an address nobody configured.
        res = await doFetch(built.url, { method: spec.method, headers: built.headers, body: built.body, signal, redirect: "error" });
        // Reading the body is part of the attempt: a connection that breaks after the headers of a
        // 201 must fail like any other lost answer, with the key in the error and the same retry rule.
        data = await readBody(res);
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        const timedOut = timeout.aborted;
        const err = new DaymakerError({
          kind: timedOut ? "timeout" : "network",
          code: timedOut ? "timeout" : "network_error",
          message: timedOut
            ? `${spec.method} ${spec.path} timed out after ${options.timeoutMs ?? this.opts.timeoutMs}ms`
            : `${spec.method} ${spec.path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
          attempts: attempt,
          ...ctx,
        });
        if (spec.retrySafe && attempt <= maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw err;
      }

      if (res.ok) {
        // Every answer of this API is a JSON object. Anything else is another server talking
        // (a proxy page, a wrong DAYMAKER_API_URL), and must not pass for a result.
        if (data === null || typeof data !== "object" || Array.isArray(data)) {
          throw new DaymakerError({
            kind: "api",
            status: res.status,
            code: "invalid_response",
            message: `${spec.method} ${spec.path} answered ${res.status} with something that is not a JSON object. Check the API address: ${this.urls.api}`,
            requestId: res.headers.get("x-request-id"),
            body: data,
            attempts: attempt,
            ...ctx,
          });
        }
        return {
          data: data as OperationOutput<K>,
          status: res.status,
          requestId: res.headers.get("x-request-id"),
          idempotencyKey: built.idempotencyKey,
          idempotentReplay: res.headers.get("idempotent-replay") === "true",
          attempts: attempt,
          headers: res.headers,
        };
      }

      const err = errorFromResponse(res.status, data, res.headers, { ...ctx, attempts: attempt });
      const wait = this.retryDelay(spec, err, attempt);
      if (wait !== null && attempt <= maxRetries) {
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  /** Milliseconds to wait before the same request goes again, or null when the failure is yours to see. */
  private retryDelay(spec: OperationSpec, err: DaymakerError, attempt: number): number | null {
    const status = err.status ?? 0;
    const withinCap = (ms: number) => (ms <= this.opts.maxRetryDelayMs ? ms : null);
    // The request may have acted: the caller checks what was done before anything is sent again.
    if (CHECK_BEFORE_RETRY.has(err.code)) return null;
    // 429: refused before any work. Waited out only when the window is short;
    // a day's limit says hours, so that one is the caller's to see.
    if (status === 429) return err.retryAfterMs === null ? null : withinCap(err.retryAfterMs);
    // The first request with this Idempotency-Key is still running: the same key may go again.
    if (err.code === "idempotency_in_flight") return withinCap(err.retryAfterMs ?? backoff(attempt));
    if (!spec.retrySafe) return null;
    if (status === 503 && err.retryAfterMs !== null) return withinCap(err.retryAfterMs);
    if (status === 500 || status === 502 || status === 503 || status === 504) return backoff(attempt);
    return null;
  }

  private build(spec: OperationSpec, input: JsonObject, options: RequestOptions) {
    const take = (k: string) => {
      const v = input[k];
      delete input[k];
      return v;
    };
    const invalid = (message: string) =>
      new DaymakerError({ kind: "invalid_request", code: "validation_error", message, operationId: spec.operationId });

    // A blank key means "none given": a model fills optional strings with "". Sent as it is, the
    // API would read an empty header as no key at all, and a retry could then act twice.
    const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    const inputKey = take("idempotency_key");
    const given = !blank(options.idempotencyKey) ? options.idempotencyKey : !blank(inputKey) ? inputKey : undefined;
    let suppliedKey: string | undefined;
    if (given !== undefined) {
      if (spec.idempotency === "none") throw invalid(`${spec.operationId} takes no Idempotency-Key`);
      suppliedKey = String(given).trim();
      if (suppliedKey.length > 255 || !VISIBLE_WITH_SPACES.test(suppliedKey)) {
        throw invalid(`${spec.operationId}: idempotency_key must be 1 to 255 visible characters`);
      }
    }

    let path = spec.path;
    for (const name of spec.pathParams) {
      const v = take(name);
      if (v === undefined || v === null || v === "") throw invalid(`${spec.operationId} needs \`${name}\``);
      // "." and ".." would be folded away by URL rules and reach a different address.
      if (/^\.{1,2}$/.test(String(v))) throw invalid(`${spec.operationId}: \`${name}\` is not an id`);
      path = path.replace(`{${name}}`, encodeURIComponent(String(v)));
    }
    const url = new URL(this.urls.api + path);
    for (const q of spec.queryParams) {
      const v = take(q.name);
      if (v === undefined || v === null) {
        if (q.required) throw invalid(`${spec.operationId} needs \`${q.name}\``);
        continue;
      }
      url.searchParams.set(q.name, String(v));
    }

    // Header names have no case. Going through Headers lets the client's own win over a caller's
    // `Authorization` or `Content-Type` however it is spelt, instead of both being sent.
    let h: Headers;
    try {
      h = new Headers(options.headers);
    } catch {
      throw invalid(`${spec.operationId}: a header in the request options is not a valid header`);
    }
    h.delete("x-api-key");
    h.set("accept", "application/json");
    h.set("authorization", `Bearer ${this.#apiKey}`);
    h.set("user-agent", this.opts.userAgent);

    let body: string | undefined;
    if (spec.hasBody) {
      // The API refuses unknown body fields itself, at any depth, and says which.
      body = JSON.stringify(input);
      h.set("content-type", "application/json");
    } else {
      h.delete("content-type");
      const unknown = Object.keys(input).filter((k) => input[k] !== undefined);
      if (unknown.length) throw invalid(`${spec.operationId} has no field named ${unknown.map((k) => `\`${k}\``).join(", ")}`);
    }

    let idempotencyKey: string | null = null;
    h.delete("idempotency-key");
    if (spec.idempotency !== "none") {
      idempotencyKey = suppliedKey ?? (this.opts.idempotencyKeyFactory ?? randomUUID)();
      h.set("idempotency-key", idempotencyKey);
    }
    return { url: url.toString(), headers: Object.fromEntries(h.entries()), body, idempotencyKey };
  }
}

function backoff(attempt: number): number {
  const cap = Math.min(8_000, 500 * 2 ** (attempt - 1));
  return Math.round(cap / 2 + Math.random() * (cap / 2));
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export { parseRetryAfter };
