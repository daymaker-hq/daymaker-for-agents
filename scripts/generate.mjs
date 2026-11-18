#!/usr/bin/env node
// Builds the SDK's operation table and types from the published Daymaker API
// contract (spec/openapi.json).
//   node scripts/generate.mjs           regenerate from the committed spec
//   node scripts/generate.mjs --fetch   download the live contract first
//   node scripts/generate.mjs --check   fail if generated files are stale
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import { DENY } from "./check-public.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = join(ROOT, "spec/openapi.json");
const OUT_DIR = join(ROOT, "packages/sdk/src/generated");
const LIVE = process.env.DAYMAKER_OPENAPI_URL ?? "https://daymaker.com/api/v2/openapi.json";
const args = new Set(process.argv.slice(2));

if (args.has("--fetch")) {
  const res = await fetch(LIVE, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${LIVE} -> ${res.status}`);
  // Stored exactly as served, so a diff of the file shows exactly what the contract changed.
  const text = await res.text();
  JSON.parse(text);
  await writeFile(SPEC, text);
  console.log(`fetched ${LIVE}`);
}

// spec/openapi.json stays a byte copy of what daymaker.com serves. What the SDK
// and the tools say is built from this working copy, with one correction.
const spec = JSON.parse(await readFile(SPEC, "utf8"));
const METHODS = ["get", "post", "put", "patch", "delete"];
const SCOPES = ["read", "work", "send"];
/** Input names the SDK adds itself; a contract field with one of these names would be shadowed. */
const RESERVED = new Set(["idempotency_key"]);
/** Names the client class uses itself; an operation with one of them would replace the method. */
const RESERVED_OPERATIONS = new Set(["call", "request", "pages", "urls", "keyKind", "build", "retryDelay", "opts", "constructor"]);

// The contract tells a raw HTTP caller to write a time zone's plus sign as %2B.
// The SDK encodes query values itself, so that advice would encode it twice.
const ENCODING_ADVICE = "; send a zone's + as %2B";
function forSdk(text) {
  const out = (text ?? "").split(ENCODING_ADVICE).join("");
  if (/%2B/i.test(out)) throw new Error(`the contract has URL-encoding advice the generator does not know: ${out.slice(0, 160)}`);
  return out;
}
for (const item of Object.values(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    if (op.description) op.description = forSdk(op.description);
    for (const p of op.parameters ?? []) if (p.description) p.description = forSdk(p.description);
  }
}

const ops = [];
const seen = new Set();
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const id = op.operationId;
    if (!id || seen.has(id)) throw new Error(`missing or duplicate operationId at ${method} ${path}`);
    if (RESERVED_OPERATIONS.has(id)) throw new Error(`operationId ${id} is a name the client uses itself`);
    seen.add(id);

    const scope = op["x-scope"];
    if (!SCOPES.includes(scope)) throw new Error(`${id}: x-scope is ${JSON.stringify(scope)}; expected one of ${SCOPES.join(", ")}`);

    const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
    // A parameter behind a $ref has no `in` here, so it would be skipped without a word. If the
    // contract ever moves Idempotency-Key there, every write would lose its key.
    for (const p of params) if (p.$ref || !p.in || !p.name) throw new Error(`${id}: a parameter is a $ref or has no name; the generator reads parameters in place`);
    for (const name of path.match(/\{([^}]+)\}/g)?.map((s) => s.slice(1, -1)) ?? []) {
      if (!params.some((p) => p.in === "path" && p.name === name)) throw new Error(`${id}: path parameter ${name} is not declared`);
    }
    const idem = params.find((p) => p.in === "header" && p.name.toLowerCase() === "idempotency-key");
    const otherHeaders = params.filter((p) => p.in === "header" && p !== idem);
    if (otherHeaders.length) throw new Error(`${id}: header parameter ${otherHeaders[0].name} is not handled by the SDK`);
    const idempotency = idem ? (idem.required ? "required" : "optional") : "none";

    const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
    if (op.requestBody && !bodySchema) throw new Error(`${id}: the request body is not application/json`);
    if (bodySchema && (bodySchema.type !== "object" || bodySchema.additionalProperties !== false)) {
      throw new Error(`${id}: expected a closed JSON object body`);
    }
    const bodyProps = bodySchema?.properties ?? {};
    const pathParams = params.filter((p) => p.in === "path").map((p) => p.name);
    const queryParams = params.filter((p) => p.in === "query").map((p) => ({ name: p.name, required: Boolean(p.required) }));

    const properties = {};
    const required = [];
    for (const p of params.filter((p) => p.in === "path" || p.in === "query")) {
      if (properties[p.name]) throw new Error(`${id}: parameter ${p.name} is declared twice`);
      properties[p.name] = { ...(p.schema ?? { type: "string" }), ...(p.description ? { description: p.description } : {}) };
      if (p.required) required.push(p.name);
    }
    for (const [k, v] of Object.entries(bodyProps)) {
      if (properties[k]) throw new Error(`${id}: body field ${k} collides with a parameter`);
      properties[k] = v;
    }
    for (const r of bodySchema?.required ?? []) required.push(r);
    for (const k of Object.keys(properties)) {
      if (RESERVED.has(k)) throw new Error(`${id}: the contract now has a field named ${k}; the SDK uses that name for the Idempotency-Key header`);
    }
    if (idempotency !== "none") {
      properties.idempotency_key = {
        type: "string",
        maxLength: 255,
        description:
          (idempotency === "required"
            ? "Sent as the Idempotency-Key header, which this operation requires. "
            : "Sent as the Idempotency-Key header. ") +
          "One is generated when you leave it out and comes back with the answer. When no answer comes back (a timeout, a dropped connection), send the same key again: Daymaker gives the first answer back instead of acting twice. Use a new key only for a new request.",
      };
    }

    ops.push({
      operationId: id,
      method: method.toUpperCase(),
      path,
      summary: op.summary ?? "",
      description: op.description ?? "",
      tag: op.tags?.[0] ?? "",
      scope,
      mcpTool: op["x-mcp-tool"] ?? null,
      // The contract gives every operation that can use credits a max_credits ceiling.
      credits: "max_credits" in bodyProps,
      idempotency,
      // Safe to send again after a timeout or a 5xx: a read, a price check (the read scope changes nothing), or a write that carries an Idempotency-Key.
      retrySafe: method === "get" || scope === "read" || idempotency !== "none",
      pathParams,
      queryParams,
      bodyFields: Object.keys(bodyProps),
      hasBody: Boolean(bodySchema),
      inputSchema: {
        type: "object",
        properties,
        ...(required.length ? { required: [...new Set(required)] } : {}),
        additionalProperties: false,
      },
    });
  }
}

// A description that trips the scan's rules fails the generation, not just the
// scan: what the contract says ends up in tool descriptions that people read.
for (const op of ops) {
  const text = [op.summary, op.description, JSON.stringify(op.inputSchema)].join("\n");
  for (const [name, re] of DENY) {
    if (re.test(text)) throw new Error(`${op.operationId}: generated description matches deny rule "${name}"`);
  }
}

const header = "// Generated by scripts/generate.mjs from spec/openapi.json. Do not edit.\n";
const schemaTs = header + "/* eslint-disable */\n" + astToString(await openapiTS(structuredClone(spec), { alphabetize: true }));
const opsTs =
  header +
  `import type { OperationSpec } from "../operation-spec.js";\n\n` +
  `export const SPEC_VERSION = ${JSON.stringify(spec.info?.version ?? "unknown")};\n\n` +
  `export const OPERATIONS = ${JSON.stringify(Object.fromEntries(ops.map((o) => [o.operationId, o])), null, 2)} as const satisfies Record<string, OperationSpec>;\n\n` +
  `export type OperationId = keyof typeof OPERATIONS;\n`;

const files = { [join(OUT_DIR, "schema.ts")]: schemaTs, [join(OUT_DIR, "operations.ts")]: opsTs };
if (args.has("--check")) {
  let stale = false;
  for (const [file, text] of Object.entries(files)) {
    const cur = await readFile(file, "utf8").catch(() => "");
    if (cur.replace(/\r\n/g, "\n") !== text) {
      console.error(`stale: ${file} (run npm run spec:generate)`);
      stale = true;
    }
  }
  process.exit(stale ? 1 : 0);
}
await mkdir(OUT_DIR, { recursive: true });
for (const [file, text] of Object.entries(files)) await writeFile(file, text);
console.log(`generated ${ops.length} operations`);
