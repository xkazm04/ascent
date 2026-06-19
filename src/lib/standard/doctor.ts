// Emits `.ai/doctor.mjs` — the executable conformance check that PROVES what the manifest claims,
// in-repo and pre-push (the maturity rubric shifted left, out of the remote scanner). Zero runtime
// dependencies (only Node built-ins) so any repo with Node can run it; the check *contract* is
// language-neutral (see docs/AI_MANIFEST_SPEC.md) so it can be reimplemented elsewhere.
//
// The script is authored with NO backticks or ${...} so it embeds verbatim in this template literal
// and in the onboarding SKILL.md without escaping.

import type { GeneratedFile } from "./types";

const DOCTOR = `#!/usr/bin/env node
// .ai/doctor.mjs - executable conformance for the .ai/ standard (reference impl, zero-dependency).
// Usage: node .ai/doctor.mjs [--run] [--json]
//   --run   also executes capability commands to verify they actually pass (flips "verified").
//   --json  prints a JSON summary and (when ASCENT_CONFORMANCE_URL + ASCENT_CONFORMANCE_TOKEN are
//           set, e.g. in CI) POSTs it to Ascent — closing the adopt->verify->re-score loop.
// Contract: docs/AI_MANIFEST_SPEC.md. Reimplement freely; the checks are what matter, not this runner.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const RUN = process.argv.includes('--run');
const findings = [];
const add = (level, msg) => findings.push({ level, msg });
const check = (ok, label, miss) => add(ok ? 'pass' : miss, (ok ? '' : 'missing ') + label);

function kv(text, key) {
  const m = text.match(new RegExp('^' + key + ':\\\\s*(.+)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : null;
}
function sub(text, key) {
  const m = text.match(new RegExp('^\\\\s+' + key + ':\\\\s*(.+)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : null;
}
function flow(text, key) {
  const m = text.match(new RegExp('^\\\\s*' + key + ':\\\\s*\\\\[([^\\\\]]*)\\\\]', 'm'));
  return m ? m[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean) : [];
}
function capabilities(text) {
  const block = text.split(/\\ncapabilities:\\n/)[1];
  if (!block) return {};
  const caps = {};
  for (const line of block.split('\\n')) {
    // command is JSON.stringify'd by the serializer, so the value can contain backslash-escaped
    // quotes (\\") and other JSON escapes. Match the full quoted string (escapes allowed) and JSON-
    // parse it back so a command containing a " round-trips exactly, instead of truncating at \\".
    const m = line.match(/^\\s{2}([\\w-]+):\\s*\\{\\s*command:\\s*("(?:[^"\\\\]|\\\\.)*")/);
    if (m) { try { caps[m[1]] = JSON.parse(m[2]); } catch { caps[m[1]] = m[2].replace(/^"|"$/g, ''); } }
    else if (/^[^\\s#]/.test(line)) break;
  }
  return caps;
}

const path = '.ai/manifest.yaml';
if (!existsSync(path)) {
  add('fail', 'missing .ai/manifest.yaml - run the Ascent onboarding skill to scaffold the standard');
} else {
  const text = readFileSync(path, 'utf8');

  // 1. structure
  const schema = kv(text, 'schema');
  const ver = kv(text, 'schemaVersion') || '0';
  if (schema === 'ai-manifest') add('pass', 'manifest schema ok (' + schema + ' v' + ver + ')');
  else add('fail', 'manifest schema id is not "ai-manifest"');
  if (ver.split('.')[0] !== '0') add('warn', 'manifest major v' + ver.split('.')[0] + ' is newer than this doctor (0.x) - update the doctor');

  // 2. pointers resolve - scope to the paths: block so a like-named capability (e.g. an "evals"
  // capability) can't shadow paths.evals via a naive first-match.
  const pathsBlock = (text.split(/\\npaths:\\n/)[1] || '').split(/\\n[a-z]/i)[0];
  const ctxIndex = sub(pathsBlock, 'contextIndex') || '.ai/context-index.json';
  check(existsSync(ctxIndex), 'context index ' + ctxIndex, 'warn');
  check(existsSync(sub(pathsBlock, 'memory') || '.ai/memory/'), 'memory store', 'warn');
  check(existsSync(sub(pathsBlock, 'evals') || 'evals/'), 'evals harness (recommended)', 'warn');

  // 3. capabilities (declared, optionally proven)
  const caps = capabilities(text);
  const names = Object.keys(caps);
  if (names.length) add('pass', 'declares ' + names.length + ' capabilities: ' + names.join(', '));
  else add('fail', 'no capabilities declared');
  for (const n of names) {
    if (/<.*>/.test(caps[n])) add('warn', 'capability "' + n + '" has a placeholder command - fill it in');
    else if (RUN) {
      try { execSync(caps[n], { stdio: 'ignore', timeout: 180000 }); add('pass', 'verified "' + n + '": ' + caps[n]); }
      catch { add('fail', 'capability "' + n + '" FAILED: ' + caps[n]); }
    }
  }

  // 4. control placement (shift-left): pre-push is primary, CI is the thin backstop. Check not just
  // that a hook EXISTS, but that each declared & backed pre-push control is actually wired into it.
  const prePush = flow(text, 'prePush');
  const hookFile = ['lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml'].find(existsSync);
  const hasHusky = existsSync('.husky');
  if (prePush.length && !hookFile && !hasHusky) {
    add('fail', 'prePush controls declared but NO local hook (lefthook/husky/pre-commit) - they only fire after push');
  } else if (prePush.length) {
    let hookText = hookFile ? readFileSync(hookFile, 'utf8') : '';
    if (hasHusky) for (const f of readdirSync('.husky')) { try { hookText += '\\n' + readFileSync('.husky/' + f, 'utf8'); } catch {} }
    hookText = hookText.toLowerCase();
    const ALIAS = { lint: ['lint', 'eslint', 'ruff', 'biome', 'clippy', 'rubocop'], typecheck: ['typecheck', 'tsc', 'mypy', 'pyright', 'go vet'], test: ['test', 'vitest', 'jest', 'pytest', 'go test'], 'scan-secrets': ['gitleaks', 'trufflehog', 'detect-secrets', 'ggshield'], coverage: ['coverage', '--cov'], format: ['prettier', 'format', 'gofmt', 'rustfmt'] };
    for (const c of prePush) {
      if (!caps[c]) continue; // a missing capability is reported below; don't double-warn
      const al = ALIAS[c] || [c];
      if (!al.some((a) => hookText.includes(a)))
        add('warn', 'pre-push control "' + c + '" is backed but not found in your local hook (' + (hookFile || '.husky') + ') - it may only run in CI (too late). Wire it in.');
    }
  }
  for (const c of prePush) if (!caps[c]) add('warn', 'pre-push control "' + c + '" has no backing capability yet - an onboarding track should add it');
  const ciHard = flow(text, 'ciHardPass');
  const hasCi = existsSync('.github/workflows') && readdirSync('.github/workflows').length > 0;
  if (ciHard.length && !hasCi) add('warn', 'ciHardPass controls declared but no CI workflows found');

  // 5. freshness
  const gen = kv(text, 'generatedAt');
  for (const f of flow(text, 'generatedFrom')) {
    if (existsSync(f) && gen && statSync(f).mtime.toISOString().slice(0, 10) > gen)
      add('warn', 'manifest may be stale: ' + f + ' changed after generatedAt (' + gen + ') - regenerate');
  }
  if (existsSync(ctxIndex)) {
    try {
      for (const m of (JSON.parse(readFileSync(ctxIndex, 'utf8')).modules || []))
        if (m.context && !existsSync(m.context)) add('fail', 'context-index references missing ' + m.context);
    } catch { add('warn', 'context-index.json is not valid JSON'); }
  }
  if (/TODO/.test(text)) add('warn', 'manifest still has TODO placeholders (purpose / secretsFrom / boundaries / agents)');
}

const weight = { pass: 1, warn: 0.5, fail: 0 };
const score = findings.length ? Math.round(100 * findings.reduce((a, f) => a + weight[f.level], 0) / findings.length) : 0;
const icon = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL' };
console.log('\\n.ai conformance - ' + ROOT);
for (const f of findings) console.log('  [' + icon[f.level] + '] ' + f.msg);
const fails = findings.filter(f => f.level === 'fail').length;
const warns = findings.filter(f => f.level === 'warn').length;
console.log('\\nConformance: ' + score + '%  (' + fails + ' fail, ' + warns + ' warn)');
if (!RUN) console.log('Tip: re-run with --run to execute and verify capability commands.');
console.log('Then re-scan in Ascent to confirm the maturity delta.');

// --json: machine-readable summary + optional auto-report to Ascent (the adopt->verify->re-score loop).
if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ score: score, fails: fails, warns: warns, findings: findings }) + '\\n');
  const reportUrl = process.env.ASCENT_CONFORMANCE_URL;
  const reportTok = process.env.ASCENT_CONFORMANCE_TOKEN;
  const reportRepo = process.env.GITHUB_REPOSITORY;
  if (reportUrl && reportTok && reportRepo && typeof fetch === 'function') {
    try {
      await fetch(reportUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + reportTok },
        body: JSON.stringify({ repo: reportRepo, headSha: process.env.GITHUB_SHA || null, score: score, fails: fails, warns: warns }),
      });
      console.log('Reported conformance to Ascent.');
    } catch (err) {
      console.error('Conformance report failed:', err && err.message);
    }
  }
} else {
  console.log('Tip: --json reports this back to Ascent (set ASCENT_CONFORMANCE_URL + ASCENT_CONFORMANCE_TOKEN in CI).');
}
process.exit(fails > 0 ? 1 : 0);
`;

export function buildDoctor(): GeneratedFile {
  return {
    path: ".ai/doctor.mjs",
    body: DOCTOR,
    purpose: "Executable conformance: proves the manifest's claims in-repo, pre-push (run: node .ai/doctor.mjs).",
    lang: "javascript",
  };
}
