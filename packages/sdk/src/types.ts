import type { operations } from "./generated/schema.js";
import type { OPERATIONS, OperationId } from "./generated/operations.js";

export type { OperationId };
export type JsonObject = { [key: string]: unknown };

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type ObjectOrEmpty<T> = [T] extends [never] ? {} : [T] extends [undefined] ? {} : T extends object ? T : {};
type Op<K extends OperationId> = operations[K];
type Params<K extends OperationId> = Op<K> extends { parameters: infer P } ? P : never;
type PathOf<K extends OperationId> = ObjectOrEmpty<NonNullable<Params<K> extends { path?: infer X } ? X : never>>;
type QueryOf<K extends OperationId> = ObjectOrEmpty<NonNullable<Params<K> extends { query?: infer X } ? X : never>>;
type BodyOf<K extends OperationId> = ObjectOrEmpty<
  NonNullable<Op<K> extends { requestBody?: infer B } ? B : never> extends { content: { "application/json": infer J } }
    ? J
    : never
>;
type IdempotencyOf<K extends OperationId> = (typeof OPERATIONS)[K]["idempotency"] extends "none"
  ? {}
  : {
      /** Sent as the `Idempotency-Key` header. Generated for you when left out; send the same one again to retry without acting twice. */
      idempotency_key?: string;
    };

/**
 * The flattened input of one operation: path params, query params and body
 * fields side by side, plus `idempotency_key` where the API takes one.
 */
export type OperationInput<K extends OperationId> = Simplify<PathOf<K> & QueryOf<K> & BodyOf<K> & IdempotencyOf<K>>;

type ResponsesOf<K extends OperationId> = Op<K> extends { responses: infer R } ? R : never;
type JsonOf<T> = T extends { content: { "application/json": infer J } } ? J : never;
type SuccessOf<R> = { [S in keyof R]: S extends 200 | 201 | 202 ? JsonOf<R[S]> : never }[keyof R];

/** The body of a 200, 201 or 202 answer, as the contract describes it. A field with nothing in it is left out, so read a missing field as empty. */
export type OperationOutput<K extends OperationId> = [SuccessOf<ResponsesOf<K>>] extends [never]
  ? JsonObject
  : SuccessOf<ResponsesOf<K>>;

/** The lists that take `offset` and answer `next_offset`. */
export type PagedOperationId = {
  [K in OperationId]: "offset" extends keyof QueryOf<K> ? K : never;
}[OperationId];

export interface RequestOptions {
  /** Overrides `idempotency_key` in the input. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

export interface DaymakerResponse<T> {
  data: T;
  status: number;
  /** `X-Request-Id`: quote it when asking Daymaker about this request. */
  requestId: string | null;
  /** The key that was sent, so you can keep it and retry later without acting twice. */
  idempotencyKey: string | null;
  /** True when the API gave back the first answer for this key instead of acting again. */
  idempotentReplay: boolean;
  attempts: number;
  headers: Headers;
}

export type OperationArgs<K extends OperationId> = {} extends OperationInput<K>
  ? [input?: OperationInput<K>, options?: RequestOptions]
  : [input: OperationInput<K>, options?: RequestOptions];

/** One method per Daymaker API operation, named by its `operationId`. */
export type DaymakerOperations = {
  [K in OperationId]: (...args: OperationArgs<K>) => Promise<OperationOutput<K>>;
};
