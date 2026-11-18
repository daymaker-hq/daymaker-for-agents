// Bundles the stdio MCP server into one dependency-free file, bin/daymaker-mcp.mjs,
// so the plugin (and anyone with Node 22) can run it without npm install, and
// writes THIRD-PARTY-NOTICES.md: the license of every package whose code is in
// that file. Both are committed; CI checks they are current.
import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ["packages/mcp/src/cli.ts"],
  outfile: "bin/daymaker-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: { "@daymaker/sdk": "./packages/sdk/src/index.ts" },
  banner: { js: 'import { createRequire as __dmCreateRequire } from "node:module"; const require = __dmCreateRequire(import.meta.url);' },
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});
console.log("bundled bin/daymaker-mcp.mjs");

// Every package with at least one file in the bundle, by the folder it was read from.
const packageDirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const at = input.lastIndexOf("node_modules/");
  if (at === -1) continue;
  const rest = input.slice(at + "node_modules/".length).split("/");
  const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  packageDirs.add(input.slice(0, at) + "node_modules/" + name);
}

const lf = (s) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
const packages = [];
for (const dir of packageDirs) {
  const abs = join(root, dir);
  const pkg = JSON.parse(await readFile(join(abs, "package.json"), "utf8"));
  const file = (await readdir(abs)).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) throw new Error(`${pkg.name} has no license file; add its license text here by hand before shipping it in the bundle`);
  packages.push({ name: pkg.name, version: pkg.version, license: String(pkg.license ?? "see below"), text: lf(await readFile(join(abs, file), "utf8")) });
}
packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const notices = [
  "# Third-party notices",
  "",
  "The single-file build of the local MCP server, `bin/daymaker-mcp.mjs`, contains code from the packages below. Each is used under its own license, reproduced here. The npm packages `@daymaker/sdk` and `@daymaker/mcp` contain none of this code: they name their dependencies and npm installs them.",
  "",
  "This file is written by `scripts/bundle.mjs`. Do not edit it by hand.",
  "",
  ...packages.flatMap((p) => [`## ${p.name} ${p.version}`, "", `License: ${p.license}`, "", "```text", p.text, "```", ""]),
].join("\n");
await writeFile(join(root, "THIRD-PARTY-NOTICES.md"), notices);
console.log(`wrote THIRD-PARTY-NOTICES.md (${packages.length} packages)`);
