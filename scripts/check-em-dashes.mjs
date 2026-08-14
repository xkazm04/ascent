#!/usr/bin/env node
// Reports em dashes (U+2014) in text a user reads. A one-time sweep decays: the models that write
// most of this repo reach for the character constantly, so without a check it comes back a file at a
// time and nobody notices until the whole surface reads like a model again.
//
// SCOPE, deliberately narrow. It reports only what the 2026-08-14 sweep actually cleaned:
//   - string literals and JSX text in src/ (rendered copy, email bodies, alert text, error messages)
//   - prose in markdown docs
// It does NOT report:
//   - CODE COMMENTS. Out of scope by decision: this codebase's comments are dense and carry design
//     rationale, and rewriting ~8,600 of them is churn with no user-visible gain.
//   - The empty-value placeholder glyph (a standalone `—` meaning "no value" in a table cell). That
//     is a UI convention, not a sentence.
//   - Fenced code blocks in markdown, which quote source verbatim (comments included).
//   - docs/archive/** (append-only point-in-time records) and docs/harness/** (gitignored output).
//
// This is a REPORTER, not a fixer, and it is not wired into any hook or CI gate. Run it by hand:
//   node scripts/check-em-dashes.mjs          # report, exit 1 if anything is found
//   node scripts/check-em-dashes.mjs --quiet  # exit code only
//
// Note the LLM-written half of the product is handled separately and cannot be checked from here:
// src/lib/llm/prose.ts carries the prompt rule and the deEmDash backstop in the parse path.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const EM = "—";
const QUIET = process.argv.includes("--quiet");

// An ALLOW-list, not a deny-list, because most of this repo is not product text and a deny-list keeps
// losing that argument: `uat/` and `tiger/` are dated skill run-records (7,000+ em dashes between them,
// all point-in-time artifacts like `docs/archive`), `.claude/` is agent tooling and loop state, `e2e/`
// and `scripts/` are test and tooling code, and CHANGELOG is history. What a USER of the app reads is
// `src/`, `docs/`, and a handful of repo-root documents — that is the scope, so name it directly.
// prose.ts and its test are the machinery that REMOVES em dashes, so they necessarily contain the
// character (the constant, the rules, and every fixture). Scanning them reports the cure as the disease.
const SELF = /^src\/lib\/llm\/prose(\.test)?\.ts$/;

const IN_SCOPE = (f) =>
  (f.startsWith("src/") || f.startsWith("docs/") || !f.includes("/")) &&
  !/^docs\/(archive|harness)\//.test(f) &&
  !SELF.test(f) &&
  f !== "CHANGELOG.md";

/** Blank out block and line comments so their em dashes are not reported. Crude on purpose: it only
 *  has to be right about where a comment STARTS, and a false blank costs a missed report, not a bad
 *  edit. `://` is excluded so a URL inside a string is not mistaken for a line comment. */
function stripCodeComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Blank out fenced code blocks in markdown, which quote source (and its comments) verbatim. */
function stripFences(src) {
  return src.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));
}

/** A standalone dash used as the "no value" cell glyph, not prose. */
const PLACEHOLDER = /(^|[>"'`([{:,=?\s])\s*—\s*($|[<"'`)\]},;\s])/;

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const hits = [];

for (const f of files) {
  if (!IN_SCOPE(f)) continue;
  const isMd = f.endsWith(".md");
  const isCode = /\.(ts|tsx|mjs)$/.test(f);
  if (!isMd && !isCode) continue;

  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (!src.includes(EM)) continue;

  const scanned = isMd ? stripFences(src) : stripCodeComments(src);
  scanned.split("\n").forEach((line, i) => {
    if (!line.includes(EM)) return;
    // A line whose ONLY dash is the placeholder glyph is a UI convention, not prose.
    if (line.split(EM).length - 1 === 1 && PLACEHOLDER.test(line)) return;
    hits.push({ file: f, line: i + 1, text: line.trim().slice(0, 120) });
  });
}

if (hits.length === 0) {
  if (!QUIET) console.log("No em dashes in user-facing text.");
  process.exit(0);
}

if (!QUIET) {
  const byFile = new Map();
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
  console.log(`${hits.length} em dash${hits.length === 1 ? "" : "es"} in user-facing text, across ${byFile.size} file(s):\n`);
  for (const h of hits.slice(0, 60)) console.log(`  ${h.file}:${h.line}  ${h.text}`);
  if (hits.length > 60) console.log(`  … and ${hits.length - 60} more`);
  console.log("\nRewrite the sentence rather than swapping in a colon; see src/lib/llm/prose.ts for the house rule.");
}
process.exit(1);
