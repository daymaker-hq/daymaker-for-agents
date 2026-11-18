export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * What a key may do, chosen when the key is made. `read` sees the workspace
 * and prices, `work` changes it (some of it uses credits), `send` reaches
 * people and money in the key owner's name.
 */
export type KeyScope = "read" | "work" | "send";

/** One Daymaker API operation, as generated from the published contract. */
export interface OperationSpec {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Path below the API base URL, e.g. `/leads/{lead_id}`. */
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  /** The contract's group: Workspace, Leads, Gifts, Campaigns, Sending, Orders, Pipeline or Signals. */
  readonly tag: string;
  /** The key scope the operation needs. A key without it gets 403 `insufficient_scope`. */
  readonly scope: KeyScope;
  /** The tool of the hosted Daymaker MCP server that does the same thing, when there is one. */
  readonly mcpTool: string | null;
  /** True when the operation can use credits: it takes `max_credits`, the most the person agreed to spend. */
  readonly credits: boolean;
  /** Whether the API takes an `Idempotency-Key` header, and whether it insists. */
  readonly idempotency: "required" | "optional" | "none";
  /** Safe to send again after a timeout or a 5xx: a read, a price check, or a write that carries an Idempotency-Key. */
  readonly retrySafe: boolean;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly { readonly name: string; readonly required: boolean }[];
  readonly bodyFields: readonly string[];
  readonly hasBody: boolean;
  /** Flattened JSON Schema of the SDK and MCP input: path, query and body fields side by side, plus `idempotency_key` where the API takes one. */
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: { readonly [name: string]: unknown };
    readonly required?: readonly string[];
    readonly additionalProperties: false;
  };
}
