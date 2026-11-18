// The hosted Daymaker MCP server, as an agent client meets it before anyone has
// signed in. Needs the network and no secret. Nothing here signs in: these
// checks prove the server is where the configs say it is and that it tells a
// client how to sign in.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_URL, OAUTH_RESOURCE_METADATA, OAUTH_SERVER_METADATA } from "../scripts/agents.mjs";
import { FAKE_KEY, ROOT, mcpInitialize } from "./helpers.js";

const getJson = async (url: string) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe(`the hosted server at ${MCP_URL}`, () => {
  it("refuses an anonymous client with 401 and says where its sign-in documents are", async () => {
    const { status, headers } = await mcpInitialize(MCP_URL);
    expect(status).toBe(401);
    const challenge = headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${OAUTH_RESOURCE_METADATA}"`);
    expect(challenge).toContain('scope="app"');
  });

  it("names itself as the resource and daymaker.com as the place to sign in", async () => {
    const { status, body } = await getJson(OAUTH_RESOURCE_METADATA);
    expect(status).toBe(200);
    expect(body.resource).toBe(MCP_URL);
    expect(body.authorization_servers).toContain(new URL(MCP_URL).origin);
    expect(body.scopes_supported).toContain("app");
  });

  it("tells a client where to register and sign in, with PKCE", async () => {
    const { status, body } = await getJson(OAUTH_SERVER_METADATA);
    expect(status).toBe(200);
    const origin = new URL(MCP_URL).origin;
    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      expect(String(body[key]), key).toMatch(new RegExp(`^${origin}/`));
    }
    expect(body.code_challenge_methods_supported).toContain("S256");
    expect(body.scopes_supported).toContain("app");
  });

  // A real API key is not tried here: this suite holds no secret. It shows that a bearer which is
  // not a Daymaker sign-in gets 401.
  it("refuses a bearer that is not a Daymaker sign-in", async () => {
    const { status, body } = await mcpInitialize(MCP_URL, { authorization: `Bearer ${FAKE_KEY}` });
    expect(status).toBe(401);
    expect(body.result).toBeUndefined();
  });

  it("is the remote the MCP Registry entry and every plugin manifest name", async () => {
    const read = async (p: string) => JSON.parse(await readFile(join(ROOT, p), "utf8"));
    expect((await read("server.json")).remotes).toEqual([{ type: "streamable-http", url: MCP_URL }]);
    expect((await read(".mcp.json")).mcpServers.daymaker).toEqual({ type: "http", url: MCP_URL });
    expect((await read("mcp.json")).mcpServers.daymaker).toEqual({ type: "streamable-http", url: MCP_URL });
    expect((await read("mcp_config.json")).mcpServers.daymaker).toEqual({ url: MCP_URL });
  });
});
