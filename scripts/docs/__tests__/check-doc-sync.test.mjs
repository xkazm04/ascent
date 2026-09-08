#!/usr/bin/env node
// Zero-dep test for the doc-sync Stop hook.
// Run: node scripts/docs/__tests__/check-doc-sync.test.mjs
//
// Covers two things that actually break in practice:
//   1. the glob compiler's semantics (** vs *, anchoring)
//   2. every sourceGlob in feature-doc-map.json matching at least one real file
//      — a typo'd glob silently disables the nag for that whole feature area.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
}

// Mirror of compileGlob in check-doc-sync.mjs. Kept in sync by the tests below;
// if you change one, change both.
function compileGlob(pattern) {
  const re = pattern
    .split('/')
    .map((segment) => {
      if (segment === '**') return '__GLOBSTAR__';
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/')
    .replace(/\/__GLOBSTAR__\//g, '(/.*)?/')
    .replace(/^__GLOBSTAR__\//, '(.*/)?')
    .replace(/\/__GLOBSTAR__$/, '(/.*)?')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${re}$`);
}

console.log('glob semantics');
ok(compileGlob('src/lib/scan.ts').test('src/lib/scan.ts'), 'exact match');
ok(!compileGlob('src/lib/scan.ts').test('src/lib/scan-cache.ts'), 'exact does not prefix-match');
ok(compileGlob('src/lib/llm/**').test('src/lib/llm/index.ts'), '** matches one level');
ok(compileGlob('src/lib/llm/**').test('src/lib/llm/a/b/c.ts'), '** matches deep');
ok(!compileGlob('src/lib/llm/**').test('src/lib/scan.ts'), '** is anchored');
ok(compileGlob('src/lib/org/skill-*.ts').test('src/lib/org/skill-sync.ts'), '* within segment');
ok(!compileGlob('src/lib/org/skill-*.ts').test('src/lib/org/skill/sync.ts'), '* does not cross /');
ok(compileGlob('prisma/schema.prisma').test('prisma/schema.prisma'), 'non-src path');

console.log('feature-doc-map.json');
const mapPath = path.join(REPO_ROOT, 'scripts/docs/feature-doc-map.json');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
ok(Array.isArray(map.entries) && map.entries.length > 0, 'has entries');

// Every declared doc must exist on disk.
for (const entry of map.entries) {
  ok(fs.existsSync(path.join(REPO_ROOT, entry.doc)), `doc exists: ${entry.doc}`);
  ok(entry.doc.startsWith('docs/features/'), `doc is under docs/features/: ${entry.doc}`);
  ok(
    Array.isArray(entry.sourceGlobs) && entry.sourceGlobs.length > 0,
    `has sourceGlobs: ${entry.doc}`,
  );
}

// Every sourceGlob must match at least one tracked file. This is the check that
// catches a renamed directory silently switching the nag off.
const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
ok(tracked.length > 0, 'git ls-files returned files');

for (const entry of map.entries) {
  for (const glob of entry.sourceGlobs) {
    const re = compileGlob(glob);
    ok(tracked.some((f) => re.test(f)), `glob matches a tracked file: ${glob}`);
  }
}

// ...AND THE CONVERSE. The check above proves no glob has gone dead; it cannot prove the map
// REACHES a directory, so a whole feature tab could be invisible to the Stop hook while every
// assertion passed — which is exactly what had happened: bought/contributors, bought/teams,
// standing/adoption, admin/members and admin/settings matched no glob at all, so editing them
// never nagged (found 2026-09-08 during the /org UX redesign). A one-directional matcher reports
// a covered codebase in a voice indistinguishable from success; this is the other direction.
//
// The unit is the TAB — src/features/<group>/<tab> — because that is the granularity the nav, the
// feature tree and the docs all share. A new tab must be added to the map in the same change.
const allGlobs = map.entries.flatMap((e) => e.sourceGlobs.map(compileGlob));
// A tab is the file's own directory, truncated to at most four segments — which lands on
// `src/features/<group>/<tab>` for a grouped tab and on `src/features/developer` for the one group
// whose files sit directly under it. Truncating (rather than assuming depth 4) is what keeps a
// nested `live/parts/` from being scored as a tab of its own.
const featureTabs = [
  ...new Set(
    tracked
      .filter((f) => f.startsWith('src/features/'))
      .map((f) => f.split('/').slice(0, -1).slice(0, 4).join('/')),
  ),
];
ok(featureTabs.length > 0, 'found feature tab directories to check');
for (const dir of featureTabs) {
  const covered = tracked.some((f) => f.startsWith(`${dir}/`) && allGlobs.some((re) => re.test(f)));
  ok(covered, `feature tab is reachable from some sourceGlob: ${dir}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
