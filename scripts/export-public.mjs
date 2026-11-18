// Builds the public tree: copies the files git tracks that public-files.json
// lists into a new, empty folder, then scans the result.
//   node scripts/export-public.mjs <outDir>
//
// Only tracked files are copied. A working tree also holds what git ignores
// (a .env with a real key, notes, build output), and none of that may travel.
// Nothing is ever deleted: the folder must not exist yet, or be empty.
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scanDir } from "./check-public.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node scripts/export-public.mjs <outDir>");
  process.exit(1);
}
const out = resolve(outDir);
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);
if (inside(out, root) || inside(root, out)) {
  console.error(`refusing to export into ${out}: it is this repository, or a folder around or inside it`);
  process.exit(1);
}
if (existsSync(out) && (await readdir(out)).length) {
  console.error(`refusing to export into ${out}: the folder is not empty. Give a new folder; this script deletes nothing.`);
  process.exit(1);
}

const list = JSON.parse(await readFile(join(root, "public-files.json"), "utf8"));
const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const files = new Set((list.files ?? []).map(norm));
const dirs = (list.dirs ?? []).map(norm);
const exclude = (list.exclude ?? []).map(norm);
const under = (rel, d) => rel === d || rel.startsWith(d + "/");
const wanted = (rel) => (files.has(rel) || dirs.some((d) => under(rel, d))) && !exclude.some((e) => under(rel, e));

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
// What is copied is what is on disk. With uncommitted edits to tracked files that is not any
// commit, so a release is exported from a clean tree. --dirty is for trying things out.
const dirty = git("status", "--porcelain", "--untracked-files=no").trim();
if (dirty && !process.argv.includes("--dirty")) {
  console.error(`refusing to export: tracked files have uncommitted changes. Commit them, or pass --dirty to try an export that is not a release.\n${dirty}`);
  process.exit(1);
}
const tracked = git("ls-files", "-z").split("\0").filter(Boolean).map(norm);
for (const f of files) if (!tracked.includes(f)) throw new Error(`public-files.json names a file git does not track: ${f}`);
for (const d of dirs) if (!tracked.some((t) => under(t, d))) throw new Error(`public-files.json names a folder with no tracked file: ${d}`);
for (const e of exclude) if (!tracked.some((t) => under(t, e))) throw new Error(`public-files.json excludes a path git does not track: ${e}`);

const copied = tracked.filter(wanted);
await mkdir(out, { recursive: true });
for (const rel of copied) {
  const dst = join(out, rel);
  await mkdir(join(dst, ".."), { recursive: true });
  await cp(join(root, rel), dst);
}

// A checkout may hold a folder of extra scan rules. It is not part of this tree.
if (existsSync(join(out, "internal"))) {
  console.error("export-public: the export contains an internal/ folder; take it out of public-files.json");
  process.exit(1);
}

const problems = await scanDir(out);
if (problems.length) {
  console.error(`export-public: the scan failed on ${out}`);
  for (const p of problems) console.error(`- ${p.file}:${p.line} [${p.rule}] ${p.text}`);
  process.exit(1);
}
console.log(`export-public: ${copied.length} files -> ${out} (scan clean)`);
