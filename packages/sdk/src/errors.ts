export type DaymakerErrorKind = "api" | "network" | "timeout" | "invalid_request";

export interface DaymakerFieldProblem {
  field: string;
  problem: string;
}

export interface DaymakerErrorInit {
  kind: DaymakerErrorKind;
  message: string;
  code?: string;
  status?: number;
  requestId?: string | null;
  fields?: DaymakerFieldProblem[];
  details?: Record<string, unknown>;
  retryAfterMs?: number | null;
  body?: unknown;
  operationId?: string;
  idempotencyKey?: string | null;
  attempts?: number;
  cause?: unknown;
}

/**
 * Answers that mean the request may have acted, so sending it again could act
 * twice. Check what was done first (read the lead, the campaign or the
 * orders); a new attempt then needs a new Idempotency-Key.
 */
export const CHECK_BEFORE_RETRY: ReadonlySet<string> = new Set(["outcome_unknown", "partially_done", "in_progress"]);

/**
 * Every failure the SDK raises. `status` and `code` come straight from the
 * API's `{ error: { code, message, request_id, ... } }` envelope; `details`
 * is that whole `error` object, with the fields a code brings along
 * (`new_quote` with `quote_changed`, `needs` with `insufficient_scope`,
 * `purchase_id` with `in_progress`, `next`, and so on).
 *
 * Branch on `status` and `code`. `message` is for people and may change.
 *
 * When `idempotencyKey` is set and the error is a timeout, a network error or
 * a 5xx, send the same call again with that key: Daymaker gives the first
 * answer back instead of acting twice. The exceptions are the codes in
 * `CHECK_BEFORE_RETRY`.
 */
export class DaymakerError extends Error {
  override readonly name = "DaymakerError";
  readonly kind: DaymakerErrorKind;
  readonly code: string;
  readonly status: number | undefined;
  readonly requestId: string | null;
  readonly fields: DaymakerFieldProblem[];
  readonly details: Record<string, unknown>;
  readonly retryAfterMs: number | null;
  readonly body: unknown;
  readonly operationId: string | undefined;
  readonly idempotencyKey: string | null;
  readonly attempts: number;

  constructor(init: DaymakerErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.code = init.code ?? (init.status ? `http_${init.status}` : init.kind);
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.fields = init.fields ?? [];
    this.details = init.details ?? {};
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.body = init.body;
    this.operationId = init.operationId;
    this.idempotencyKey = init.idempotencyKey ?? null;
    this.attempts = init.attempts ?? 1;
  }

  /** True when the request may have acted and must be checked before it is sent again. */
  get checkBeforeRetry(): boolean {
    return CHECK_BEFORE_RETRY.has(this.code);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      status: this.status ?? null,
      code: this.code,
      message: this.message,
      request_id: this.requestId,
      fields: this.fields.length ? this.fields : undefined,
      details: Object.keys(this.details).length ? this.details : undefined,
      retry_after_ms: this.retryAfterMs,
      operation_id: this.operationId,
      idempotency_key: this.idempotencyKey,
      attempts: this.attempts,
    };
  }
}

export function isDaymakerError(err: unknown): err is DaymakerError {
  return err instanceof DaymakerError;
}

/** Parses `Retry-After` (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
  extra: Pick<DaymakerErrorInit, "operationId" | "idempotencyKey" | "attempts">,
): DaymakerError {
  const env =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : null;
  const message =
    typeof env?.message === "string"
      ? env.message
      : typeof body === "string" && body.trim()
        ? body.trim().slice(0, 500)
        : `The Daymaker API answered HTTP ${status}`;
  return new DaymakerError({
    kind: "api",
    status,
    code: typeof env?.code === "string" ? env.code : undefined,
    message,
    requestId: (typeof env?.request_id === "string" ? env.request_id : null) ?? headers.get("x-request-id"),
    fields: Array.isArray(env?.fields) ? (env.fields as DaymakerFieldProblem[]) : undefined,
    details: env ?? undefined,
    retryAfterMs: parseRetryAfter(headers.get("retry-after")),
    body,
    ...extra,
  });
}
