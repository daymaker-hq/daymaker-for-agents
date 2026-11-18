import { OPERATIONS, type KeyScope, type OperationId, type OperationSpec } from "@daymaker/sdk";

export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: { readonly [name: string]: unknown };
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface DaymakerTool {
  name: string;
  operationId: OperationId;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export const SCOPES: readonly KeyScope[] = ["read", "work", "send"];
const MAX_DESCRIPTION = 1800;

/** `sendGiftLinks` -> `send_gift_links`: one tool per API operation, named after the SDK method. */
export function toolName(operationId: string): string {
  return operationId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** An act the API itself guards with a required Idempotency-Key: it reaches people or money and cannot be taken back. */
const isSend = (op: OperationSpec) => op.idempotency === "required";
/** A send that was priced first: it takes the quote's revision or its total. */
const isPriced = (op: OperationSpec) => op.bodyFields.includes("quote_revision") || op.bodyFields.includes("total_usd");

/**
 * What a tool that sends asks for in place of the SDK's "generated when left
 * out". A tool call can outlast the client's patience (an MCP client stops
 * waiting after about a minute; a send to many people takes longer), and a
 * generated key would then be lost with the answer. A key the model made up
 * before the call is still in its hands, so calling again cannot send twice.
 */
const SEND_KEY_DESCRIPTION =
  "Required. Make up a unique string before the call (a UUID is fine) and keep it. It is sent as the Idempotency-Key header. If no answer comes back, or the answer is idempotency_in_flight, call again with the same arguments and this same key: Daymaker gives the first answer back instead of sending twice. Use a new key only for a new send.";

function inputSchemaFor(op: OperationSpec): ToolInputSchema {
  if (!isSend(op)) return op.inputSchema;
  return {
    ...op.inputSchema,
    properties: {
      ...op.inputSchema.properties,
      idempotency_key: { type: "string", minLength: 1, maxLength: 255, description: SEND_KEY_DESCRIPTION },
    },
    required: [...new Set([...(op.inputSchema.required ?? []), "idempotency_key"])],
  };
}

function describe(op: OperationSpec): string {
  const lines = [op.summary.trim(), "", `${op.method} /api/v2${op.path} (scope: ${op.scope}).`];
  if (isSend(op) && isPriced(op)) {
    lines.push(
      "SENDS in the person's name: it reaches people or makes a payment page, and cannot be taken back. Run its price check first, show the person who gets what and the price, and get a yes.",
    );
  } else if (isSend(op)) {
    lines.push(
      "ACTS in public in the person's name and cannot be taken back. There is no price check: show the person the exact words and where they go, and get a yes first.",
    );
  }
  if (op.credits) {
    lines.push("Can use credits. Say what it costs, get a yes, and pass max_credits: the most the person agreed to spend.");
  }
  if (isSend(op)) {
    lines.push("Needs idempotency_key: make one up before the call, and send the same one again if no answer comes back.");
  } else if (op.idempotency !== "none") {
    lines.push(
      "An Idempotency-Key is generated when you leave idempotency_key out and comes back with the answer. If no answer comes back, pass a key of your own next time and repeat it.",
    );
  }
  // The contract ends each description with its scope, which the line above already says.
  const desc = op.description.replace(/\s*Scope: `\w+`\.\s*$/, "").trim();
  let text = lines.join("\n") + (desc && desc !== op.summary.trim() ? `\n\n${desc}` : "");
  if (text.length > MAX_DESCRIPTION) text = text.slice(0, MAX_DESCRIPTION - 3).trimEnd() + "...";
  return text;
}

export interface ToolFilter {
  /** Only the tools that change nothing: reads and price checks (the `read` scope). */
  readOnly?: boolean;
  /** Only the tools these scopes reach, e.g. the scopes your key holds. */
  scopes?: readonly KeyScope[];
}

export function buildTools(filter: ToolFilter = {}): DaymakerTool[] {
  return (Object.values(OPERATIONS) as OperationSpec[])
    .filter((op) => !filter.readOnly || op.scope === "read")
    .filter((op) => !filter.scopes?.length || filter.scopes.includes(op.scope))
    .map((op) => ({
      name: toolName(op.operationId),
      operationId: op.operationId as OperationId,
      title: op.summary || op.operationId,
      description: describe(op),
      inputSchema: inputSchemaFor(op),
      annotations: {
        title: op.summary || op.operationId,
        // The read scope changes nothing, also where the method is POST (a price check).
        readOnlyHint: op.scope === "read",
        // MCP reads false as "only adds". Outside the read scope a tool here may replace a note,
        // swap a pick, spend credits or send, so none of them promises that.
        destructiveHint: op.scope !== "read",
        // Repeating a read, a set-to-value or a removal changes nothing more. So does repeating a
        // send, because its key is part of the arguments. Any other POST gets a new key on each
        // call and would act again.
        idempotentHint: op.scope === "read" || op.method === "PUT" || op.method === "DELETE" || isSend(op),
        openWorldHint: true,
      },
    }));
}
