// The committed bundle (bin/daymaker-mcp.mjs) over stdio, the way an agent
// client starts it. Needs the network for one call and no secret: that call
// carries a key that is not one, and the API's own 401 proves the request went
// to the Daymaker API and came back through the tool.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OPERATIONS, SDK_VERSION } from "@daymaker/sdk";
import { SERVER_NAME } from "@daymaker/mcp";
import { FAKE_KEY, runBundle, stdioClient, toolJson } from "./helpers.js";

describe("the local server over stdio", () => {
  let client: Client;
  beforeAll(async () => {
    client = await stdioClient({ DAYMAKER_KEY: FAKE_KEY, DAYMAKER_API_URL: "", DAYMAKER_MCP_READ_ONLY: "", DAYMAKER_MCP_SCOPES: "" });
  });
  afterAll(async () => {
    await client?.close();
  });

  it("introduces itself and carries its rules", () => {
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SDK_VERSION });
    expect(client.getInstructions()).toMatch(/get_me/);
  });

  it("offers one tool per API operation", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(Object.keys(OPERATIONS).length);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_me", "list_leads", "quote_gift_links", "send_gift_links"]));
  });

  it("reaches the Daymaker API: a key that is not one gets the API's own 401", async () => {
    const res = await client.callTool({ name: "get_me", arguments: {} });
    expect(res.isError).toBe(true);
    const out = toolJson<{ error: { status: number; code: string; request_id: string | null } }>(res);
    expect(out.error.status).toBe(401);
    expect(out.error.code).toBe("unauthenticated");
    expect(out.error.request_id).toBeTruthy();
  });
});

describe("starting the local server", () => {
  it("offers only reads and price checks when asked to", async () => {
    const client = await stdioClient({ DAYMAKER_KEY: FAKE_KEY, DAYMAKER_MCP_READ_ONLY: "1", DAYMAKER_MCP_SCOPES: "" });
    try {
      const { tools } = await client.listTools();
      const readOnly = Object.values(OPERATIONS).filter((o) => o.scope === "read").length;
      expect(tools).toHaveLength(readOnly);
      for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("stops with a plain reason when there is no key", async () => {
    const { code, stdout, stderr } = await runBundle([], { DAYMAKER_KEY: "" });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/No Daymaker API key/);
    expect(stderr).toMatch(/Settings, API and MCP/);
  });

  it("tells a Cold Caked key where it belongs instead of sending it", async () => {
    const { code, stderr } = await runBundle([], { DAYMAKER_KEY: "dm_test_" + "x".repeat(43) });
    expect(code).toBe(1);
    expect(stderr).toMatch(/Cold Caked Cake API key/);
  });

  it("refuses a scope that does not exist", async () => {
    const { code, stderr } = await runBundle([], { DAYMAKER_KEY: FAKE_KEY, DAYMAKER_MCP_SCOPES: "read,everything" });
    expect(code).toBe(1);
    expect(stderr).toMatch(/"everything"/);
  });

  it("prints its version and its help without a key", async () => {
    const version = await runBundle(["--version"], { DAYMAKER_KEY: "" });
    expect(version).toMatchObject({ code: 0, stdout: `${SDK_VERSION}\n` });
    const help = await runBundle(["--help"], { DAYMAKER_KEY: "" });
    expect(help.code).toBe(0);
    for (const name of ["DAYMAKER_KEY", "DAYMAKER_API_URL", "DAYMAKER_MCP_READ_ONLY", "DAYMAKER_MCP_SCOPES"]) expect(help.stdout).toContain(name);
  });
});
