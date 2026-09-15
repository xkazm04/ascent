#!/usr/bin/env node
// Guidance signal saturation census (study 2026-09-15 ai-engineering-coach, feature 5, test T3).
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/guidance-signal-census.mjs [--inputs <dir>] [--dumps <dir>] [--json]
//
// An instrument, not a product change. It asks one question of the D1 content grader
// (`guidanceQuality`, src/lib/analyze/guidance-quality.ts): which of its signals carry information?
// A signal that fires on nearly every real guidance file cannot tell a good file from a bad one, so
// its points are a flat bonus for having a file at all. Two corpora, two layers:
//
//   1. CONTENT: every guidance file inside the captured bench fixtures (bench/matrix-inputs, the
//      gitignored {scoreInput, snapshot} replays from scripts/matrix/capture.mts), graded by the REAL
//      guidanceQuality, imported from source (Node 24 strips the types). Byte-identical copies count
//      once: a repo that mirrors AGENTS.md into CLAUDE.md wrote one document, not two.
//   2. PERSISTED: the D1 evidence labels stored on the reference-scan reports in
//      reference-data/dump-*.json. No file contents survive in those dumps, so this layer reads what
//      the detector of the day AWARDED, under whatever regexes it ran then. It is a different layer
//      from (1) on purpose: a saturation reading that only one layer shows is a small-sample reading.
//
// Plus the T3 stuffed control: a synthetic 4001-character CLAUDE.md that names each trigger phrase
// once inside neutral filler. If it reaches the grader's maximum while the median real file does not,
// the proxy pays for vocabulary rather than for guidance.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { guidanceQuality } from "../src/lib/analyze/guidance-quality.ts";

/** A signal firing on more than this share of real files is a zero-information candidate. */
export const SATURATION = 0.85;

/** The stuffed control's length: one character past the grader's top length tier. */
export const STUFFED_LENGTH = 4001;

// Copies of GUIDANCE_PATH_RE / GUIDANCE_DIR_RE from src/lib/analyze/context-health.ts. That module
// imports extensionless siblings, which plain Node cannot resolve, so the census carries the two
// regexes and its test fails if they drift from the source text.
export const GUIDANCE_PATH_RE =
  /((^|\/)(claude\.md|agents?\.md|agent\.md|\.cursorrules|\.windsurfrules)|^\.github\/copilot-instructions\.md)$/i;
export const GUIDANCE_DIR_RE = /^(\.cursor\/rules\/.+\.mdc?|\.windsurf\/rules\/.+\.mdc?|\.github\/instructions\/.+\.md)$/i;
export const isGuidancePath = (p) => GUIDANCE_PATH_RE.test(p) || GUIDANCE_DIR_RE.test(p);

/**
 * One trigger phrase per content signal, each chosen to fire exactly its own rule (the test pins
 * that). "npm run test" is deliberately not the commands phrase: it also matches `run (the )?tests?`.
 */
export const TRIGGERS = ["pytest", "architecture", "before committing", "never", "subagent", "allowed tools", "for example", "@docs/guide.md"];
const FILLER = "The quick brown fox jumps over the lazy dog near the quiet river bank. ";

/** The T3 control: every trigger once, neutral filler, exactly `length` characters. */
export function stuffedControl(length = STUFFED_LENGTH) {
  let text = "# Notes\n\n" + TRIGGERS.map((t) => `${FILLER}The word ${t} appears here once.\n`).join("");
  while (text.length < length) text += FILLER;
  return text.slice(0, length);
}

export const pointsOf = (text) => guidanceQuality(text).reduce((a, g) => a + g.points, 0);

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Guidance files from capture fixtures, deduped by content hash. */
export function collectFixtureFiles(dir) {
  const files = [];
  const seen = new Set();
  let duplicates = 0;
  if (!existsSync(dir)) return { files, duplicates };
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const fx = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const f of fx.snapshot?.files ?? []) {
      if (!isGuidancePath(f.path) || typeof f.content !== "string" || !f.content) continue;
      const hash = createHash("sha256").update(f.content).digest("hex");
      if (seen.has(hash)) {
        duplicates++;
        continue;
      }
      seen.add(hash);
      files.push({ repo: fx.repo, path: f.path, text: f.content });
    }
  }
  return { files, duplicates };
}

/** Per-label fire rate over graded texts. Labels are read off the grader, never hand-listed. */
export function census(texts) {
  const counts = new Map();
  for (const t of texts) for (const label of new Set(guidanceQuality(t).map((g) => g.label))) counts.set(label, (counts.get(label) ?? 0) + 1);
  return rowsFrom(counts, texts.length, allLabels());
}

/** Every label the grader can emit: the stuffed control plus a mid-length file cover all of them. */
export function allLabels() {
  const labels = new Set(guidanceQuality(stuffedControl()).map((g) => g.label));
  for (const g of guidanceQuality(stuffedControl(1200))) labels.add(g.label);
  return [...labels];
}

function rowsFrom(counts, n, labels) {
  return labels.map((label) => {
    const fired = counts.get(label) ?? 0;
    const rate = n ? fired / n : 0;
    return { label, fired, n, rate, saturated: n > 0 && rate > SATURATION };
  });
}

/**
 * The persisted layer: D1 evidence labels on stored reports. The denominator is every report whose
 * D1 graded a guidance document, recognised by a presence line or by any grader label.
 */
export function persistedCensus(dir) {
  const labels = allLabels();
  const counts = new Map();
  let graded = 0;
  let reports = 0;
  if (!existsSync(dir)) return { reports, rows: rowsFrom(counts, 0, labels) };
  for (const name of readdirSync(dir).filter((n) => /^dump-.*\.json$/.test(n)).sort()) {
    const dump = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const r of dump.reports ?? []) {
      const d1 = r.report?.dimensions?.find((d) => d.id === "D1");
      if (!d1) continue;
      reports++;
      const ev = (d1.evidence ?? []).map(String);
      const fired = labels.filter((l) => ev.some((e) => e.startsWith(l)));
      const present = ev.some((e) => /^(Found (CLAUDE|AGENTS)\.md|Found Cursor rules|Agent guidance present)/.test(e));
      if (!present && !fired.length) continue;
      graded++;
      for (const l of fired) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  return { reports, rows: rowsFrom(counts, graded, labels) };
}

/** GUIDANCE_QUALITY_MAX, the normalizer Context Health divides by, read from its source. */
export function graderMax() {
  const src = readFileSync(new URL("../src/lib/analyze/context-health.ts", import.meta.url), "utf8");
  return Number(/const GUIDANCE_QUALITY_MAX = (\d+);/.exec(src)?.[1] ?? NaN);
}

export function runCensus({ inputs, dumps }) {
  const { files, duplicates } = collectFixtureFiles(inputs);
  const content = census(files.map((f) => f.text));
  const points = files.map((f) => pointsOf(f.text));
  // D1 grades ONE document per repo (the canonical node), and a pointer like `@AGENTS.md` is not it.
  // The largest guidance file per repo is the offline proxy for that graded document.
  const largest = new Map();
  for (const f of files) if ((largest.get(f.repo)?.text.length ?? -1) < f.text.length) largest.set(f.repo, f);
  const stuffed = stuffedControl();
  return {
    content: { files: files.length, duplicates, repos: largest.size, rows: content },
    // Small n by construction (one row per captured repo): read it beside the persisted layer.
    graded: census([...largest.values()].map((f) => f.text)),
    persisted: persistedCensus(dumps),
    t3: {
      stuffedChars: stuffed.length,
      stuffedPoints: pointsOf(stuffed),
      graderMax: graderMax(),
      medianAllFiles: median(points),
      medianGradedPerRepo: median([...largest.values()].map((f) => pointsOf(f.text))),
      perFile: files.map((f, i) => ({ repo: f.repo, path: f.path, chars: f.text.length, points: points[i] })),
    },
  };
}

function print(result) {
  const pct = (r) => `${Math.round(r * 100)}%`.padStart(4);
  const table = (title, rows) => {
    console.log(`\n${title}`);
    for (const r of rows) console.log(`  ${pct(r.rate)}  ${String(r.fired).padStart(3)}/${r.n}  ${r.saturated ? "SATURATED " : "          "}${r.label}`);
  };
  const c = result.content;
  table(`[T3] content layer: ${c.files} unique guidance files from ${c.repos} repos (${c.duplicates} byte-identical copies dropped)`, c.rows);
  table(`[T3] graded layer: the largest guidance file of each of ${c.repos} repos`, result.graded);
  table(`[T3] persisted layer: ${result.persisted.rows[0]?.n ?? 0} graded of ${result.persisted.reports} stored reports`, result.persisted.rows);
  const t = result.t3;
  console.log(`\n[T3] stuffed control: ${t.stuffedChars} chars, ${t.stuffedPoints} guidance points (grader max ${t.graderMax})`);
  console.log(`[T3] real median: ${t.medianAllFiles} over every file, ${t.medianGradedPerRepo} over the largest file per repo`);
  for (const f of t.perFile) console.log(`  ${String(f.points).padStart(3)} pts  ${String(f.chars).padStart(6)} chars  ${f.repo} ${f.path}`);
  const sat = [...c.rows, ...result.graded, ...result.persisted.rows].filter((r) => r.saturated).map((r) => `${r.label} (${r.fired}/${r.n})`);
  console.log(`\n[T3] zero-information candidates (> ${SATURATION * 100}%): ${sat.length ? [...new Set(sat)].join("; ") : "none"}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const result = runCensus({ inputs: resolve(opt("--inputs", "bench/matrix-inputs")), dumps: resolve(opt("--dumps", "reference-data")) });
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else print(result);
}
