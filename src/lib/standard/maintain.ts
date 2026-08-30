// Emits `.ai/maintain.mjs` — the upkeep half of the standard. It turns the one-shot onboarding into
// CONTINUOUS maintenance: the deterministic parts (detect a CONTEXT that drifted from its code,
// append a well-formed memory entry, update a freshness anchor) are done by this script; the content
// (writing the actual CONTEXT prose, the actual lesson) is the agent's job, which this prompts for.
//
// Authored with NO backticks or ${...} so it embeds verbatim in the template literal / SKILL.md.

import type { GeneratedFile } from "./types";

const MAINTAIN = `#!/usr/bin/env node
// .ai/maintain.mjs - keep the .ai/ standard fresh as the code changes (self-maintaining upkeep).
// Subcommands:
//   check               warn when a module changed in the PUSHED range but its CONTEXT.md wasn't (pre-push)
//   note <kind> <text>  append a well-formed, auto-numbered memory entry
//   touch <module-path> record that <module>/CONTEXT.md is reconciled to the current HEAD
//   project             regenerate every vendor guidance file declared under manifest 'guidance'
//                       from the canonical document, writing the provenance hashes back
// Pass --strict to make 'check' fail (exit 1) instead of warning. Zero-dependency.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const cmd = process.argv[2] || 'check';
const MEM = '.ai/memory';
const INDEX = '.ai/context-index.json';
const git = (a) => { try { return execSync('git ' + a, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '.' : p.slice(0, i); };
const loadIndex = () => { try { return JSON.parse(readFileSync(INDEX, 'utf8')); } catch { return { modules: [] }; } };
const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };

// The set of files 'check' should police depends on WHERE it runs. It is documented for a pre-push hook,
// but PRE-PUSH is exactly where the old implementation silently did nothing: it diffed the working tree
// (git diff HEAD / --cached), yet at pre-push time everything is already committed, so that diff is EMPTY
// and every freshness/note warning was skipped for every push. We instead diff what is about to be
// pushed. Pure string->records so the parser is unit-tested verbatim; git/base resolution lives in changed().
// A ref DELETION (localSha all-zeros) pushes nothing to inspect, so it is dropped; a malformed line too.
function parsePushLines(stdin) {
  const refs = [];
  for (const line of String(stdin || '').split('\\n')) {
    const p = line.trim().split(/\\s+/);
    if (p.length < 4) continue;
    const localSha = p[1], remoteSha = p[3];
    if (!localSha || /^0+$/.test(localSha)) continue;
    refs.push({ localSha: localSha, remoteSha: remoteSha });
  }
  return refs;
}

// The rev range one pushed ref introduces. Existing remote branch: remoteSha..localSha (exactly the new
// commits). Brand-new remote branch (remoteSha all-zeros, no base to diff from): fall back to the pushed/
// tracked ref, else this tip's parent - so we still check the NEW commits, never the whole history.
function rangeFor(r) {
  if (r.remoteSha && !/^0+$/.test(r.remoteSha)) return r.remoteSha + '..' + r.localSha;
  const base = git('rev-parse --verify --quiet @{push}') || git('rev-parse --verify --quiet @{upstream}') || (r.localSha + '~1');
  return base + '..' + r.localSha;
}

function changed() {
  const files = new Set();
  const add = (out) => { for (const f of out.split('\\n')) { const t = f.trim(); if (t) files.add(t); } };
  // 1) PRE-PUSH: git pipes the pushed refs on stdin as "<localRef> <localSha> <remoteRef> <remoteSha>".
  //    Diff each pushed range - the commits about to leave this machine. A TTY stdin means there is no
  //    pushed-ref payload (an interactive run), so we never block trying to read it.
  const refs = process.stdin.isTTY ? [] : parsePushLines(readStdin());
  if (refs.length) { for (const r of refs) add(git('diff --name-only ' + rangeFor(r))); return [...files]; }
  // 2) PRE-PUSH under a hook runner that did NOT forward stdin: if HEAD is committed ahead of its push/
  //    upstream ref AND the worktree is otherwise clean, diff those unpushed commits (a clean worktree
  //    diffs to nothing - the whole bug). A dirty tree falls through to (3), so pre-commit/manual survive.
  const base = git('rev-parse --verify --quiet @{push}') || git('rev-parse --verify --quiet @{upstream}');
  if (base && !git('status --porcelain')) { add(git('diff --name-only ' + base + '..HEAD')); return [...files]; }
  // 3) MANUAL run or a PRE-COMMIT placement: the uncommitted working tree + staged index (what it can see).
  add(git('diff --name-only HEAD'));
  add(git('diff --name-only --cached'));
  return [...files];
}

if (cmd === 'check') {
  const files = changed();
  const idx = loadIndex();
  const touched = new Set(files.filter((f) => f.endsWith('CONTEXT.md')).map(dirOf));
  const warnings = [];
  for (const m of (idx.modules || [])) {
    // A root/unscoped module (path ".") matches EVERY changed file, so it would warn on literally
    // every push - including .ai/memory notes - until the root CONTEXT.md is touched in that same
    // change. That is warning fatigue out of the box (the seed index ships exactly one ".\" module).
    // Freshness tracking is only meaningful for a concrete sub-path; skip the catch-all root until
    // the repo registers real per-module entries (node .ai/maintain.mjs touch <dir>).
    const dir = String(m.path || '').replace(/\\/$/, '');
    if (dir === '' || dir === '.') continue;
    const codeHere = files.some((f) => !f.endsWith('CONTEXT.md') && f.startsWith(dir + '/'));
    if (codeHere && !touched.has(dirOf(m.context || '')))
      warnings.push('CONTEXT may be stale for "' + m.id + '" (' + m.context + '): code under ' + m.path + ' changed but CONTEXT.md did not. Refresh it, then: node .ai/maintain.mjs touch ' + m.path);
  }
  for (const w of warnings) console.log('[WARN] ' + w);
  if (!warnings.length) console.log('[OK  ] CONTEXT graph current for changed modules.');
  const memNew = files.some((f) => f.startsWith(MEM + '/') && /\\d{4}-/.test(f));
  const codeChanged = files.some((f) => !f.startsWith('.ai/') && !f.endsWith('CONTEXT.md'));
  if (codeChanged && !memNew) console.log('[INFO] Learned something durable? Log it: node .ai/maintain.mjs note <kind> "<one fact>"');
  process.exit(process.argv.includes('--strict') && warnings.length ? 1 : 0);
}

if (cmd === 'note') {
  const kind = process.argv[3] || 'note';
  const text = process.argv.slice(4).join(' ').trim();
  if (!text) { console.error('usage: node .ai/maintain.mjs note <kind> "<one fact>"'); process.exit(2); }
  if (!existsSync(MEM)) mkdirSync(MEM, { recursive: true });
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note';
  const sha = git('rev-parse --short HEAD');
  // Atomic append: derive max+1 from the CURRENT listing, then create with the exclusive 'wx' flag.
  // A plain writeFileSync here was a read-then-act race - two concurrent writers (two agents, or an
  // agent + a human) could both compute the same id, and the second write TRUNCATED the first: silent
  // loss in the append-only ledger this standard sells to multi-agent workflows. On EEXIST (same id
  // AND same slug) the loser re-lists - the winner's file now raises the max - and retries.
  for (let attempt = 0; attempt < 20; attempt++) {
    const ids = readdirSync(MEM).map((f) => parseInt((f.match(/^(\\d{4})-/) || [])[1], 10)).filter((n) => !isNaN(n));
    const next = String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, '0');
    const file = MEM + '/' + next + '-' + slug + '.md';
    const fm = '---\\nid: ' + next + '\\nkind: ' + kind + '\\nscope: repo\\ndate: ' + new Date().toISOString().slice(0, 10) + '\\nsupersedes: null\\nrefs: []\\n---\\n\\n';
    try {
      writeFileSync(file, fm + text + (sha ? '\\n\\n(at ' + sha + ')' : '') + '\\n', { encoding: 'utf8', flag: 'wx' });
      console.log('wrote ' + file);
      process.exit(0);
    } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
  }
  console.error('could not allocate a memory id after 20 attempts (concurrent writers?)');
  process.exit(1);
}

if (cmd === 'touch') {
  const dir = process.argv[3];
  if (!dir) { console.error('usage: node .ai/maintain.mjs touch <module-path>'); process.exit(2); }
  const idx = loadIndex();
  if (!idx.modules) idx.modules = [];
  const sha = git('rev-parse --short HEAD') || null;
  const ctx = (dir === '.' ? '' : dir.replace(/\\/$/, '') + '/') + 'CONTEXT.md';
  const m = idx.modules.find((x) => x.path === dir);
  if (m) { m.reconciledToSha = sha; console.log('reconciled ' + dir + ' to ' + sha); }
  else { idx.modules.push({ id: dir.replace(/[^\\w-]+/g, '-') || 'root', path: dir, context: ctx, owns: 'TODO', reconciledToSha: sha }); console.log('registered ' + dir); }
  writeFileSync(INDEX, JSON.stringify(idx, null, 2) + '\\n', 'utf8');
  process.exit(0);
}

// 'project' - render every DECLARED vendor guidance file from the canonical document.
//
// The repo's .ai/manifest.yaml 'guidance' block says which document is the authority and which vendor
// files are projections of it. This command copies the canonical body into each of them under a
// provenance header carrying two hashes: the SOURCE's hash (so a later run can tell the projection is
// behind) and the projection's OWN body hash (so a later run can tell someone hand-edited it instead
// of editing the source). doctor.mjs reads exactly those two, and the parse must stay identical here.
//
// IDEMPOTENT: the output is a pure function of the canonical body, so a second run over an unchanged
// canonical writes byte-identical files and produces no diff.
if (cmd === 'project') {
  const MPATH = '.ai/manifest.yaml';
  if (!existsSync(MPATH)) { console.error('no ' + MPATH + ' - nothing to project from'); process.exit(2); }
  const mtext = readFileSync(MPATH, 'utf8');
  const gblock = mtext.split(/\\nguidance:\\n/)[1];
  if (!gblock) { console.log('[INFO] no guidance block in ' + MPATH + ' - nothing to project. Add: guidance: { canonical, projections }'); process.exit(0); }
  const cm = gblock.match(/^\\s+canonical:\\s*(.+)$/m);
  const canonical = cm ? cm[1].trim().replace(/^"|"$/g, '') : '';
  if (!canonical || !existsSync(canonical)) { console.error('guidance.canonical is missing or does not resolve: ' + canonical); process.exit(1); }
  const sourceBody = readFileSync(canonical, 'utf8');
  const sha12 = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);
  const rows = [];
  for (const line of gblock.split('\\n')) {
    const m = line.match(/^\\s+-\\s*\\{\\s*agent:\\s*([^,]+),\\s*path:\\s*([^,]+),/);
    if (m) rows.push({ agent: m[1].trim().replace(/^"|"$/g, ''), path: m[2].trim().replace(/^"|"$/g, '') });
    else if (/^[^\\s#]/.test(line)) break;
  }
  if (!rows.length) { console.log('[INFO] guidance.projections is empty - declare the vendor files to generate, then re-run.'); process.exit(0); }
  // Cursor .mdc files need their own front matter FIRST; it is not part of the projected body and so
  // is deliberately outside the body hash (it is vendor transport, not the repo's guidance).
  const frontMatter = (p) => (/\\.mdc$/.test(p) ? '---\\nalwaysApply: true\\n---\\n' : '');
  const body = sourceBody.replace(/^(\\r?\\n)+/, '');
  const srcHash = sha12(sourceBody);
  const bodyHash = sha12(body);
  const header = '<!-- generated-from: ' + canonical + ' sha256:' + srcHash + ' \\u00b7 body: sha256:' + bodyHash + ' \\u00b7 do not edit; run: node .ai/maintain.mjs project -->';
  let wrote = 0;
  for (const r of rows) {
    if (r.path === canonical) continue;
    const out = frontMatter(r.path) + header + '\\n\\n' + body;
    const before = existsSync(r.path) ? readFileSync(r.path, 'utf8') : null;
    if (before === out) { console.log('[OK  ] ' + r.path + ' already in sync'); continue; }
    const dir = r.path.lastIndexOf('/') < 0 ? '' : r.path.slice(0, r.path.lastIndexOf('/'));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(r.path, out, 'utf8');
    wrote++;
    console.log('[WROTE] ' + r.path + ' from ' + canonical);
  }
  // Write the source hash back into the manifest's projection rows, so the declared hash and the
  // generated files agree. A row whose hash is already current is left byte-identical.
  const updated = mtext.split('\\n').map((line) => {
    if (!/^\\s+-\\s*\\{\\s*agent:/.test(line)) return line;
    return line.replace(/hash:\\s*("(?:[^"\\\\]|\\\\.)*"|[^},]*)/, 'hash: "' + srcHash + '"');
  }).join('\\n');
  if (updated !== mtext) writeFileSync(MPATH, updated, 'utf8');
  console.log('\\nProjected ' + rows.length + ' file(s), ' + wrote + ' changed. Re-run to confirm no diff.');
  process.exit(0);
}

console.error('unknown command: ' + cmd + ' (use check | note | touch | project)');
process.exit(2);
`;

export function buildMaintain(): GeneratedFile {
  return {
    path: ".ai/maintain.mjs",
    body: MAINTAIN,
    purpose: "Self-maintaining upkeep: flag stale CONTEXT (check), append memory (note), reconcile (touch), regenerate vendor guidance (project).",
    lang: "javascript",
  };
}
