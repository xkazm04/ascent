#!/usr/bin/env node
// Tests for check-map-drift.mjs. Dependency-free, same shape as scripts/docs/__tests__/ — plain node,
// no runner, `node scripts/context-map/__tests__/check-map-drift.test.mjs`.
//
// The analysis half is pure (`analyze(map, tracked)`), so almost everything here runs on fixtures. The
// last block is the one that has to touch the real repo, and it is the one that matters most: a checker
// whose own classification rules have drifted reports a clean map for a rotten one.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyze, isMappable, norm, UNMAPPED_BUDGET_PCT } from "../check-map-drift.mjs";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

const mapOf = (contexts) => ({ groups: [{ name: "G", contexts }] });
const ctx = (name, filePaths, apiRoutes = []) => ({ name, filePaths, apiRoutes });

// ── isMappable ──────────────────────────────────────────────────────────────────
test("counts src ts/tsx and the prisma schema", () => {
  assert.equal(isMappable("src/lib/x.ts"), true);
  assert.equal(isMappable("src/features/a/B.tsx"), true);
  assert.equal(isMappable("prisma/schema.prisma"), true);
});

test("ignores non-source, generated, declarations and the dev inspector", () => {
  assert.equal(isMappable("docs/x.md"), false);
  assert.equal(isMappable("scripts/y.mjs"), false);
  assert.equal(isMappable("prisma/init.sql"), false);
  assert.equal(isMappable("src/generated/prisma/index.ts"), false);
  assert.equal(isMappable("src/lib/x.d.ts"), false);
  assert.equal(isMappable("src/app/_dev-inspector/devLocate.ts"), false);
});

test("norm folds the Windows separators the map has historically carried", () => {
  assert.equal(norm("src\\lib\\db\\client.ts"), "src/lib/db/client.ts");
});

// ── dead paths and routes ───────────────────────────────────────────────────────
test("a mapped file git does not track is DEAD", () => {
  const r = analyze(mapOf([ctx("C", ["src/lib/gone.ts", "src/lib/here.ts"])]), ["src/lib/here.ts"]);
  assert.equal(r.dead.length, 1);
  assert.equal(r.dead[0].file, "src/lib/gone.ts");
  assert.equal(r.dead[0].context, "C");
});

test("dead detection reads through a Windows-separator path", () => {
  const r = analyze(mapOf([ctx("C", ["src\\lib\\here.ts"])]), ["src/lib/here.ts"]);
  assert.equal(r.dead.length, 0);
  assert.equal(r.mapped, 1);
});

test("a declared apiRoute with no route.ts behind it is DEAD", () => {
  const r = analyze(mapOf([ctx("C", [], ["/api/live", "/api/gone"])]), ["src/app/api/live/route.ts"]);
  assert.deepEqual(
    r.deadRoutes.map((d) => d.route),
    ["/api/gone"],
  );
});

// ── coverage ────────────────────────────────────────────────────────────────────
test("unmapped percentage counts only mappable files", () => {
  const tracked = ["src/lib/a.ts", "src/lib/b.ts", "docs/c.md", "src/generated/d.ts"];
  const r = analyze(mapOf([ctx("C", ["src/lib/a.ts"])]), tracked);
  assert.equal(r.mappable, 2);
  assert.deepEqual(r.unmapped, ["src/lib/b.ts"]);
  assert.equal(r.unmappedPct, 50);
});

test("an empty map is 100% unmapped rather than a crash", () => {
  const r = analyze({ groups: [] }, ["src/lib/a.ts"]);
  assert.equal(r.unmappedPct, 100);
  assert.equal(r.contexts, 0);
});

test("no mappable files is 0%, not NaN", () => {
  const r = analyze(mapOf([]), ["docs/a.md"]);
  assert.equal(r.unmappedPct, 0);
});

// ── the signal that actually matters ────────────────────────────────────────────
test("a directory NO context owns is reported as orphaned", () => {
  const tracked = ["src/lib/known/a.ts", "src/lib/known/b.ts", "src/lib/brandnew/c.ts", "src/lib/brandnew/d.ts"];
  const r = analyze(mapOf([ctx("C", ["src/lib/known/a.ts"])]), tracked);
  // known/b.ts is unmapped but its directory IS owned — bookkeeping, not a missing subsystem.
  assert.deepEqual(r.orphanDirs, [["src/lib/brandnew", 2]]);
});

test("orphan directories are ranked by size, so the biggest subsystem reads first", () => {
  const tracked = ["src/a/1.ts", "src/b/1.ts", "src/b/2.ts", "src/b/3.ts", "src/c/1.ts", "src/c/2.ts"];
  const r = analyze(mapOf([]), tracked);
  assert.deepEqual(
    r.orphanDirs.map(([d]) => d),
    ["src/b", "src/c", "src/a"],
  );
});

test("a file claimed by two contexts is reported, never failed on", () => {
  const r = analyze(mapOf([ctx("A", ["src/lib/x.ts"]), ctx("B", ["src/lib/x.ts"])]), ["src/lib/x.ts"]);
  assert.equal(r.shared.length, 1);
  assert.deepEqual(r.shared[0][1], ["A", "B"]);
  assert.equal(r.dead.length, 0);
  assert.equal(r.unmapped.length, 0);
});

// ── against the real repository ─────────────────────────────────────────────────
// These are the cases a fixture cannot cover: that the checker's own rules still describe THIS tree.
const root = path.resolve(import.meta.dirname, "../../..");
const realMap = JSON.parse(fs.readFileSync(path.join(root, "context-map.json"), "utf8"));
const realTracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .filter(Boolean);
const real = analyze(realMap, realTracked);

test("the real map names no file that has been deleted or moved", () => {
  assert.deepEqual(real.dead, []);
});

test("the real map names no route that no longer exists", () => {
  assert.deepEqual(real.deadRoutes, []);
});

test("the real map is inside its unmapped budget", () => {
  assert.ok(
    real.unmappedPct <= UNMAPPED_BUDGET_PCT,
    `unmapped ${real.unmappedPct.toFixed(1)}% exceeds the ${UNMAPPED_BUDGET_PCT}% budget`,
  );
});

test("no directory in the tree is unowned — an unowned directory is a subsystem no sweep visits", () => {
  assert.deepEqual(
    real.orphanDirs.map(([d, n]) => `${d} (${n})`),
    [],
  );
});

test("the checker still matches a real repo file, so its rules have not drifted into vacuity", () => {
  // If isMappable stopped matching anything, every assertion above would pass vacuously.
  assert.ok(real.mappable > 1000, `only ${real.mappable} mappable files found — the rules look wrong`);
  assert.ok(real.contexts > 10 && real.groups > 1);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
