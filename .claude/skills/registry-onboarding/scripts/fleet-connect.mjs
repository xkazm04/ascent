#!/usr/bin/env node
/**
 * fleet-connect — the join between the repositories checked out on THIS machine and the registry's
 * committed `projects.json`. The registry's own resolver (`scripts/lib/projects.mjs`) answers
 * "where is declared project X?"; nothing answers the reverse, "which local repo points at this
 * registry but is not declared?" — and an undeclared consumer is invisible to `link-registry`,
 * `build-registry-map` and every fleet pass, silently.
 *
 *   node fleet-connect.mjs [--registry <dir>] [--depth 2] [--json] [--write]
 *
 * Reports four row states:
 *   connected    declared for this machine, checkout exists, its manifest points at this registry
 *   undeclared   a local repo whose .ai/manifest.yaml points here, absent from projects.json
 *   missing      declared for this machine, no checkout at the resolved path
 *   unpointed    declared and present, but its manifest has no registry.local resolving here
 *
 * `--write` adds each `undeclared` row to projects.json under this machine's key with a path
 * RELATIVE to the machine root (the file's portability contract). It never removes a row and never
 * edits a manifest. Exit 0 clean, 1 findings, 2 cannot run.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1] ?? null; };
const SKIP = new Set(['node_modules', 'AppData', 'target', 'dist', 'build']);

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const real = (p) => { try { return fs.realpathSync(p).toLowerCase(); } catch { return null; } };

function fail(msg) { console.error(`FATAL: ${msg}`); process.exit(2); }

// The registry: explicit, or the one this repo's manifest names.
let registry = value('--registry');
if (!registry) {
  const m = fs.existsSync('.ai/manifest.yaml') && fs.readFileSync('.ai/manifest.yaml', 'utf8').match(/^\s*local:\s*(\S+)/m);
  registry = m ? path.resolve(m[1]) : null;
}
if (!registry || !fs.existsSync(path.join(registry, 'projects.json'))) fail('no registry with projects.json (pass --registry <dir>)');
const registryReal = real(registry);
const fleetFile = path.join(registry, 'projects.json');
const fleet = readJson(fleetFile);
const machineCfg = readJson(path.join(registry, '.machine.local.json'));
if (!fleet?.projects) fail('projects.json did not parse');
if (!machineCfg?.machine || !machineCfg?.root) fail('.machine.local.json needs "machine" and "root" — this machine has no identity');
const { machine, root } = machineCfg;
const overrides = machineCfg.overrides ?? {};

/** registry.local out of a manifest, resolved against the project it sits in. */
function pointsHere(dir) {
  const file = path.join(dir, '.ai', 'manifest.yaml');
  if (!fs.existsSync(file)) return { manifest: false, here: false };
  const m = fs.readFileSync(file, 'utf8').match(/^\s*local:\s*(\S+)/m);
  return { manifest: true, here: !!m && real(path.resolve(dir, m[1].replace(/^["']|["']$/g, ''))) === registryReal };
}

// Discovery: directories under the machine root, to --depth, that carry a manifest.
const depth = Number(value('--depth') ?? 2);
const found = [];
(function walk(dir, d) {
  if (d > depth) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (fs.existsSync(path.join(abs, '.ai', 'manifest.yaml'))) found.push(abs);
    else walk(abs, d + 1);
  }
})(root, 1);

const rows = [];
const declaredReal = new Map();
for (const [slug, decl] of Object.entries(fleet.projects)) {
  const rel = overrides[slug] ?? decl.checkouts?.[machine];
  if (!rel) continue;
  const abs = path.resolve(root, rel);
  const r = real(abs);
  if (r) declaredReal.set(r, slug);
  if (!r) { rows.push({ slug, state: 'missing', path: rel }); continue; }
  rows.push({ slug, state: pointsHere(abs).here ? 'connected' : 'unpointed', path: rel });
}
if (registryReal) declaredReal.set(registryReal, '(registry)');

const additions = [];
for (const abs of found) {
  if (declaredReal.has(real(abs)) || !pointsHere(abs).here) continue;
  const rel = path.relative(root, abs).split(path.sep).join('/');
  const slug = path.basename(abs).toLowerCase();
  if (fleet.projects[slug]?.checkouts?.[machine]) { rows.push({ slug, state: 'undeclared', path: rel, note: `slug taken for ${machine} at ${fleet.projects[slug].checkouts[machine]}` }); continue; }
  rows.push({ slug, state: 'undeclared', path: rel });
  additions.push({ slug, rel });
}

if (flag('--write') && additions.length) {
  for (const { slug, rel } of additions) {
    fleet.projects[slug] ??= { checkouts: {} };
    fleet.projects[slug].checkouts ??= {};
    fleet.projects[slug].checkouts[machine] = rel;
    rows.find((r) => r.slug === slug && r.state === 'undeclared').state = 'declared';
  }
  fs.writeFileSync(fleetFile, `${JSON.stringify(fleet, null, 2)}\n`);
}

const findings = rows.filter((r) => r.state !== 'connected' && r.state !== 'declared');
if (flag('--json')) {
  console.log(JSON.stringify({ machine, registry, rows, written: flag('--write') ? additions.map((a) => a.slug) : [] }, null, 2));
} else {
  console.log(`fleet-connect — machine ${machine}, ${found.length} manifest(s) under the root, ${Object.keys(fleet.projects).length} declared\n`);
  for (const r of rows.sort((a, b) => a.state.localeCompare(b.state) || a.slug.localeCompare(b.slug))) {
    console.log(`  ${r.state.padEnd(11)} ${r.slug.padEnd(20)} ${r.path}${r.note ? `  (${r.note})` : ''}`);
  }
  if (flag('--write')) console.log(`\n${additions.length} declaration(s) added to projects.json — run check-projects.mjs, then link-registry.mjs --project <slug>.`);
}
process.exit(findings.length ? 1 : 0);
