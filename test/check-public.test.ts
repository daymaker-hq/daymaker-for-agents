// Unit tests for the scan that keeps secrets and private details out of this
// tree: a fixture that must fail and one that must pass.
//
// Every value below is made up, and each is joined from parts, so that this
// file passes the scan it tests. Nothing here is exempt from it.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { GENERIC, scanDir, scanText } from "../scripts/check-public.mjs";

const j = (...parts: string[]) => parts.join("");
const TAIL = "A1b2C3d4".repeat(6);

const dirs: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "check-public-"));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** One made-up line per rule, by the rule's name. */
const SAMPLES: Record<string, string> = {
  "other repository": j("See the notes in daymaker-hq/", "some-other-repo."),
  "private key": j("-----BEGIN ", "PRIVATE KEY", "-----"),
  "access token": j("token: gh", "p_", "a1B2".repeat(9)),
  "database address": j("The server reads DATABASE", "_URL, a postgres", "://user@db.example.test/app address."),
  "64 hex characters": j("signing key ", "0123456789abcdef".repeat(4)),
  "local path": j("Checked out under C:", "\\Users\\", "me\\project."),
  "internal hostname": j("The board is at tickets.internal", "-tools.com."),
  "personal address": j("Write to someone", "@daymaker", ".com."),
  "real-looking key": j("Key: dmk_live", "_", TAIL),
  "uuid literal": j("Account id 3f8b2c1a", "-9d4e-4a5b-8c6d-", "7e8f9a0b1c2d in prose."),
};

describe("check-public", () => {
  it("has a made-up sample for every rule that reads text", () => {
    const textRules = GENERIC.map(([name]) => name).filter((name) => name !== "server code dir");
    expect(Object.keys(SAMPLES).sort()).toEqual([...textRules].sort());
  });

  it.each(Object.entries(SAMPLES))("flags: %s", (rule, line) => {
    expect(scanText(line, GENERIC).map((h) => h.rule)).toContain(rule);
  });

  it("flags them in files, with the file and the line, and flags a folder of server code", async () => {
    const dir = await fixture({
      "README.md": ["# A tree with problems", ...Object.values(SAMPLES)].join("\n"),
      "services/api/index.ts": "// server code",
    });
    const problems = await scanDir(dir);
    const rules = new Set(problems.map((p) => p.rule));
    for (const [name] of GENERIC) expect(rules, name).toContain(name);
    const key = problems.find((p) => p.rule === "real-looking key")!;
    expect(key.file).toBe("README.md");
    expect(key.line).toBe(Object.keys(SAMPLES).indexOf("real-looking key") + 2);
  });

  it("passes a clean public tree", async () => {
    const dir = await fixture({
      "README.md": [
        "# Daymaker for agents",
        "Add https://daymaker.com/mcp to your client and sign in, or call the API with `Authorization: Bearer $DAYMAKER_KEY`.",
        "The API is https://daymaker.com/api/v2. Repo: https://github.com/daymaker-hq/daymaker-for-agents.",
        "Examples use dmk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx or dmk_live_...",
        "Write to contact@daymaker.com, or to support@daymaker.com.",
      ].join("\n"),
      "packages/sdk/src/index.ts": 'export const BASE = "https://daymaker.com/api/v2";',
      "packages/mcp/test/x.test.ts": 'const KEY = "dmk_live_mcp";',
    });
    expect(await scanDir(dir)).toEqual([]);
  });

  it("catches a real-looking key of either family, and lets placeholders through", () => {
    for (const prefix of [j("dmk_live", "_"), j("dmk_test", "_"), j("dm_live", "_"), j("dm_test", "_")]) {
      expect(scanText(prefix + TAIL).map((h) => h.rule), prefix).toEqual(["real-looking key"]);
    }
    expect(scanText("url https://daymaker.com/mcp, key dmk_live_xxxx, or dmk_live_...")).toEqual([]);
    expect(scanText("dmk_live_" + "x".repeat(43))).toEqual([]);
  });

  it("lets a role address through and stops a person's", () => {
    expect(scanText("contact@daymaker.com and support@daymaker.com")).toEqual([]);
    expect(scanText(j("contact@daymaker.com and someone", "@daymaker", ".com")).map((h) => h.rule)).toEqual(["personal address"]);
  });

  it("exempts no file by its name or its folder, itself included", async () => {
    const leaked = SAMPLES["real-looking key"]!;
    // Names that an earlier version of the scan skipped.
    const dir = await fixture({
      "sub/check-public.mjs": leaked,
      "test/check-public.test.ts": leaked,
      "dist/notes.txt": leaked,
      "coverage/report.txt": leaked,
      "docs/bundle.js.map": leaked,
      "yarn.lock": leaked,
    });
    expect((await scanDir(dir)).map((p) => p.file.replace(/\\/g, "/")).sort()).toEqual([
      "coverage/report.txt",
      "dist/notes.txt",
      "docs/bundle.js.map",
      "sub/check-public.mjs",
      "test/check-public.test.ts",
      "yarn.lock",
    ]);
    // And the scan's own source passes its own generic rules as plain text.
    const self = await readFile(fileURLToPath(new URL("../scripts/check-public.mjs", import.meta.url)), "utf8");
    expect(scanText(self, GENERIC)).toEqual([]);
    const me = await readFile(fileURLToPath(import.meta.url), "utf8");
    expect(scanText(me, GENERIC)).toEqual([]);
  });

  it("scans an .env file in an export, where nothing is ignored, and leaves it alone in a checkout", async () => {
    const leaked = j("DAYMAKER_KEY=dmk_live", "_", TAIL);
    const exported = await fixture({ "packages/sdk/.env": leaked });
    expect((await scanDir(exported)).map((p) => p.rule)).toEqual(["real-looking key"]);
    // A checkout has a .git folder: there the ignored .env is where a real key is meant to live.
    const checkout = await fixture({ "packages/sdk/.env": leaked, ".git/HEAD": "ref: refs/heads/main" });
    expect(await scanDir(checkout)).toEqual([]);
    // The example file is tracked, so it is scanned everywhere.
    const example = await fixture({ ".env.example": leaked, ".git/HEAD": "ref: refs/heads/main" });
    expect((await scanDir(example)).map((p) => p.rule)).toEqual(["real-looking key"]);
  });
});
