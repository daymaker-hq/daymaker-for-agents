// Scan for content that must never be in this tree: links into other
// repositories of the organisation, secrets, machine paths, addresses of
// people and real-looking keys.
//   node scripts/check-public.mjs [dir]   # default: the repo root
// Exits 1 and prints file:line for every hit. Imported by scripts/generate.mjs
// so a generated tool description that would trip a rule fails the build too.
//
// No file is exempt by name except the lockfile. That includes this one: the
// one pattern below that would match its own text is joined from two parts.
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DB_URL_ENV = ["DATABASE", "_URL"].join("");

/**
 * Each rule: [name, regex]. Matched per line, so patterns stay line-scoped.
 * Allowed: https://daymaker.com/api/v2, https://daymaker.com/mcp, this
 * repository on GitHub, and Daymaker's public role addresses. Placeholder
 * keys (dmk_live_xxxx, dmk_live_...) never match the key rule, which covers
 * both key families: Daymaker's dmk_ and Cold Caked's dm_.
 */
export const GENERIC = [
  ["other repository", /daymaker-hq\/(?!daymaker-for-agents(?![\w-]))[\w.-]+/],
  ["server code dir", /(^|[/\\])services[/\\]/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["access token", /\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bnpm_[A-Za-z0-9]{20,}|\bsk_(?:live|test)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}/],
  ["database address", new RegExp(`${DB_URL_ENV}|postgres(?:ql)?://`)],
  ["64 hex characters", /\b[0-9a-fA-F]{64}\b/],
  ["local path", /[A-Za-z]:[\\/]Users[\\/]|\/?home\/[a-z]+\/[a-z]/i],
  ["internal hostname", /\binternal-[a-z-]+\.(?:com|dev|net|io|local)\b/],
  ["personal address", /[\w.+-]+@daymaker\.com\b/],
  ["real-looking key", /dmk?_(live|test)_[A-Za-z0-9_-]{20,}/],
  ["uuid literal", /["'`]?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}["'`]?/],
];

// A checkout may carry more rules in a folder that is not part of this tree.
// They are applied when the file is there.
const EXTRA_DIR = "internal";
const extraUrl = new URL(`../${EXTRA_DIR}/rules.mjs`, import.meta.url);
export const EXTRA = existsSync(extraUrl) ? ((await import(extraUrl.href)).RULES ?? []) : [];
export const DENY = [...GENERIC, ...EXTRA];

// Public role addresses are fine.
const ALLOWED_EMAILS = new Set(["contact@daymaker.com", "support@daymaker.com", "hello@daymaker.com"]);
const EMAIL_RE = /[\w.+-]+@daymaker\.com\b/g;
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

// Never part of a commit, in a checkout or anywhere else.
const NEVER = new Set(["node_modules", ".git"]);
// Build output and reports that git ignores in a checkout.
const IGNORED_IN_CHECKOUT = new Set(["dist", "coverage"]);
// The lockfile is package names and hashes.
const SKIP_FILES = new Set(["package-lock.json"]);
const BINARY = /\.(png|jpg|jpeg|ico)$/;
const isEnvFile = (name) => /^\.env(\..+)?$/.test(name) && name !== ".env.example";

const KEY_RE = /dmk?_(live|test)_[A-Za-z0-9_-]{20,}/g;
const isPlaceholderKey = (m) => /^dmk?_(live|test)_[x0.]+$/.test(m);

/** A hit is one offending line. */
export function scanText(text, rules = DENY) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const [name, re] of rules) {
      if (!re.test(lines[i])) continue;
      if (name === "personal address") {
        const bad = (lines[i].match(EMAIL_RE) ?? []).filter((m) => !ALLOWED_EMAILS.has(m.toLowerCase()));
        if (!bad.length) continue;
      }
      if (name === "uuid literal") {
        // A real UUID is 36 hex and dash characters. The all-zero and all-f sentinels are allowed.
        const bad = (lines[i].match(UUID_RE) ?? []).filter((m) => !/^(0{8}|f{8})-/i.test(m));
        if (!bad.length) continue;
      }
      if (name === "real-looking key") {
        // Placeholders (dmk_live_xxxx, dmk_live_...) are fine; a real tail is not.
        const real = (lines[i].match(KEY_RE) ?? []).filter((m) => !isPlaceholderKey(m));
        if (!real.length) continue;
      }
      hits.push({ line: i + 1, rule: name, text: lines[i].trim().slice(0, 200) });
    }
  }
  return hits;
}

export async function scanDir(dir) {
  const problems = [];
  // A working checkout has a .git folder. There, git ignores build output and the .env files where
  // a real key is meant to live, and the folder of extra rules names what it denies. A tree with
  // no .git folder is an export: nothing in it is ignored, so every file in it is scanned.
  const checkout = existsSync(join(dir, ".git"));
  async function walk(d) {
    for (const name of await readdir(d)) {
      if (NEVER.has(name)) continue;
      if (checkout && (IGNORED_IN_CHECKOUT.has(name) || isEnvFile(name))) continue;
      if (checkout && d === dir && name === EXTRA_DIR) continue;
      const p = join(d, name);
      if ((await stat(p)).isDirectory()) {
        if (name === "services") {
          problems.push({ file: relative(dir, p) + "/", line: 0, rule: "server code dir", text: "a services/ tree is server code; it does not belong in this repo" });
          continue;
        }
        await walk(p);
        continue;
      }
      if (SKIP_FILES.has(name) || BINARY.test(name)) continue;
      const text = await readFile(p, "utf8").catch(() => null);
      if (text === null) continue;
      for (const h of scanText(text)) problems.push({ file: relative(dir, p), ...h });
    }
  }
  await walk(dir);
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
  const problems = await scanDir(dir);
  if (problems.length) {
    console.error(`check-public: ${problems.length} problem(s) under ${dir}`);
    for (const p of problems) console.error(`- ${p.file}:${p.line} [${p.rule}] ${p.text}`);
    process.exit(1);
  }
  console.log(`check-public: clean (${dir})`);
}
