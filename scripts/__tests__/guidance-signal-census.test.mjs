#!/usr/bin/env node
// Tests for the guidance signal saturation census (scripts/guidance-signal-census.mjs).
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/__tests__/guidance-signal-census.test.mjs
//
// Lives beside the other zero-dep script tests (vitest's include is `src/**`). What is pinned is what
// would make the census lie quietly: path regexes drifting from the detector's, a trigger phrase that
// fires two rules (the control would then prove nothing about "each phrase once"), a label list that
// misses a rule, and a dedupe that counts a mirrored CLAUDE.md twice.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guidanceQuality } from "../../src/lib/analyze/guidance-quality.ts";
import {
  GUIDANCE_DIR_RE,
  GUIDANCE_PATH_RE,
  SATURATION,
  STUFFED_LENGTH,
  TRIGGERS,
  allLabels,
  census,
  collectFixtureFiles,
  graderMax,
  median,
  persistedCensus,
  pointsOf,
  stuffedControl,
} from "../guidance-signal-census.mjs";

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const FILLER = "The quick brown fox jumps over the lazy dog near the quiet river bank. ";

test("path regexes are the detector's, character for character", () => {
  const health = src("src/lib/analyze/context-health.ts");
  assert.ok(health.includes(GUIDANCE_PATH_RE.toString()), "GUIDANCE_PATH_RE drifted from context-health.ts");
  assert.ok(health.includes(GUIDANCE_DIR_RE.toString()), "GUIDANCE_DIR_RE drifted from context-health.ts");
});

test("the label list covers every rule in the grader source", () => {
  const rules = (src("src/lib/analyze/guidance-quality.ts").match(/out\.push\(/g) ?? []).length;
  assert.ok(rules > 0, "positive control: the grader has rules to count");
  assert.equal(allLabels().length, rules);
});

test("filler alone fires nothing, and each trigger fires exactly one rule", () => {
  assert.deepEqual(guidanceQuality(FILLER.repeat(10)), []);
  const fired = TRIGGERS.map((t) => guidanceQuality(`${FILLER}The word ${t} appears here once.`).map((g) => g.label));
  for (const [i, labels] of fired.entries()) assert.equal(labels.length, 1, `${TRIGGERS[i]} fired ${labels.join(", ")}`);
  assert.equal(new Set(fired.flat()).size, TRIGGERS.length, "two triggers share a rule");
});

test("the stuffed control is exactly 4001 characters and holds each trigger once", () => {
  const text = stuffedControl();
  assert.equal(text.length, STUFFED_LENGTH);
  for (const t of TRIGGERS) assert.equal(text.split(t).length - 1, 1, t);
});

test("the stuffed control reaches the grader maximum the normalizer declares", () => {
  assert.ok(Number.isFinite(graderMax()), "GUIDANCE_QUALITY_MAX not found in context-health.ts");
  assert.equal(pointsOf(stuffedControl()), graderMax());
});

test("census counts a label once per file and flags only above the threshold", () => {
  const withRule = `${FILLER}never`;
  const without = FILLER;
  const texts = [...Array(9).fill(withRule), without];
  const row = census(texts).find((r) => r.label === "Defines explicit constraints / rules");
  assert.deepEqual({ fired: row.fired, n: row.n, saturated: row.saturated }, { fired: 9, n: 10, saturated: true });
  const atThreshold = census([...Array(17).fill(withRule), ...Array(3).fill(without)]).find((r) => r.fired === 17);
  assert.equal(atThreshold.rate, SATURATION);
  assert.equal(atThreshold.saturated, false, "exactly 85% is not more than 85%");
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("fixture collection keeps guidance paths and drops byte-identical copies", () => {
  const dir = mkdtempSync(join(tmpdir(), "census-fx-"));
  try {
    const body = `${FILLER}never`;
    const fx = (repo, files) => ({ repo, at: "", scoreInput: {}, snapshot: { files } });
    writeFileSync(
      join(dir, "a.json"),
      JSON.stringify(
        fx("o/a", [
          { path: "AGENTS.md", content: body },
          { path: "CLAUDE.md", content: body },
          { path: ".cursor/rules/x.mdc", content: "other" },
          { path: "README.md", content: "never" },
        ]),
      ),
    );
    const { files, duplicates } = collectFixtureFiles(dir);
    assert.deepEqual(files.map((f) => f.path), ["AGENTS.md", ".cursor/rules/x.mdc"]);
    assert.equal(duplicates, 1);
    assert.deepEqual(collectFixtureFiles(join(dir, "missing")), { files: [], duplicates: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persisted layer reads stored D1 evidence over reports that graded a document", () => {
  const dir = mkdtempSync(join(tmpdir(), "census-dump-"));
  try {
    mkdirSync(dir, { recursive: true });
    const rep = (evidence) => ({ repo: "o/r", report: { dimensions: [{ id: "D1", evidence }] } });
    writeFileSync(
      join(dir, "dump-x.json"),
      JSON.stringify({
        reports: [
          rep(["Found CLAUDE.md (Claude Code guidance)", "Defines explicit constraints / rules"]),
          rep(["Agent guidance present (1 document)"]),
          rep(["No machine-readable AI/agent guidance detected"]),
          { repo: "o/failed", report: null },
        ],
      }),
    );
    const { reports, rows } = persistedCensus(dir);
    assert.equal(reports, 3);
    const row = rows.find((r) => r.label === "Defines explicit constraints / rules");
    assert.deepEqual({ fired: row.fired, n: row.n }, { fired: 1, n: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
