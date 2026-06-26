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
//   check               warn when a changed module's CONTEXT.md wasn't refreshed (run from pre-push)
//   note <kind> <text>  append a well-formed, auto-numbered memory entry
//   touch <module-path> record that <module>/CONTEXT.md is reconciled to the current HEAD
// Pass --strict to make 'check' fail (exit 1) instead of warning. Zero-dependency.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const cmd = process.argv[2] || 'check';
const MEM = '.ai/memory';
const INDEX = '.ai/context-index.json';
const git = (a) => { try { return execSync('git ' + a, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '.' : p.slice(0, i); };
const loadIndex = () => { try { return JSON.parse(readFileSync(INDEX, 'utf8')); } catch { return { modules: [] }; } };

function changed() {
  const out = git('diff --name-only HEAD') + '\\n' + git('diff --name-only --cached');
  return [...new Set(out.split('\\n').map((s) => s.trim()).filter(Boolean))];
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
  const ids = readdirSync(MEM).map((f) => parseInt((f.match(/^(\\d{4})-/) || [])[1], 10)).filter((n) => !isNaN(n));
  const next = String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, '0');
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note';
  const sha = git('rev-parse --short HEAD');
  const file = MEM + '/' + next + '-' + slug + '.md';
  const fm = '---\\nid: ' + next + '\\nkind: ' + kind + '\\nscope: repo\\ndate: ' + new Date().toISOString().slice(0, 10) + '\\nsupersedes: null\\nrefs: []\\n---\\n\\n';
  writeFileSync(file, fm + text + (sha ? '\\n\\n(at ' + sha + ')' : '') + '\\n', 'utf8');
  console.log('wrote ' + file);
  process.exit(0);
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

console.error('unknown command: ' + cmd + ' (use check | note | touch)');
process.exit(2);
`;

export function buildMaintain(): GeneratedFile {
  return {
    path: ".ai/maintain.mjs",
    body: MAINTAIN,
    purpose: "Self-maintaining upkeep: flag stale CONTEXT (check), append memory (note), reconcile (touch).",
    lang: "javascript",
  };
}
