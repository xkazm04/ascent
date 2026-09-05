// Emits `.ai/doctor.mjs` — the executable conformance check that PROVES what the manifest claims,
// in-repo and pre-push (the maturity rubric shifted left, out of the remote scanner). Zero runtime
// dependencies (only Node built-ins) so any repo with Node can run it; the check *contract* is
// language-neutral (docs/features/onboarding/ai-manifest-spec.md, shipped to the repo as .ai/SPEC.md) so it can be
// reimplemented elsewhere.
//
// The script is authored with NO backticks or ${...} so it embeds verbatim in this template literal
// and in the onboarding SKILL.md without escaping.

import type { GeneratedFile } from "./types";

const DOCTOR = `#!/usr/bin/env node
// .ai/doctor.mjs - executable conformance for the .ai/ standard (reference impl, zero-dependency).
// Usage: node .ai/doctor.mjs [--run] [--json]
//   --run   also executes capability commands to verify they actually pass, then writes each result
//           back to .ai/manifest.yaml: "verified" flips to the run outcome (true on pass, false on
//           fail — a stale true never outlives a broken command).
//           SECURITY: --run shell-executes the commands declared in .ai/manifest.yaml. Run it ONLY on
//           code you trust. Do NOT run it on untrusted pull_request builds from forks, and never expose
//           ASCENT_CONFORMANCE_TOKEN (or any secret) to a fork-PR workflow that runs --run: a malicious
//           PR can rewrite a capability command to execute arbitrary code and exfiltrate those secrets.
//           In CI, gate --run/reporting to trusted events (push, or same-repo PRs) only.
//   --json  prints a JSON summary and (when ASCENT_CONFORMANCE_URL + ASCENT_CONFORMANCE_TOKEN are
//           set, e.g. in CI) POSTs it to Ascent — closing the adopt->verify->re-score loop.
// Score semantics: the percentage is a weighted pass ratio over the SCORABLE findings THIS run
//   emitted (pass=1, warn=0.5, fail=0) — --run adds one finding per capability, so only compare
//   scores from same-shaped runs; "fails"/"warns" are the stable headline numbers. A clause the
//   runner could not judge (no git history, for one) is emitted as level 'unchecked': counted in
//   "unchecked", excluded from BOTH halves of the ratio, and never a fail. That is what makes the
//   "same-shaped runs" rule checkable from the output instead of merely stated — an unable-to-check
//   outcome is a result, not an absence. --run gives each capability command 180 seconds before it
//   is killed and reported as FAIL. Details: .ai/SPEC.md.
// Contract: .ai/SPEC.md. Reimplement freely; the checks are what matter, not this runner.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const RUN = process.argv.includes('--run');
const findings = [];
// Levels: 'pass' | 'warn' | 'fail' | 'unchecked'. 'unchecked' is a FIRST-CLASS outcome, not a
// silence: a clause this runner declined to judge (its evidence was unavailable here) is reported
// so the reader can tell "everything passed" from "we only looked at half of it". It carries no
// weight and is not in the score's denominator, so declining to judge can neither reward nor punish.
// Every finding carries a STABLE CHECK ID as well as a message, so a receiver can track one clause
// across runs and rewordings. The vocabulary is documented in .ai/SPEC.md; ids are lower-case, dotted,
// and a repo-specific subject (a capability name, a path) is slugged into the same charset.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._\\/-]/g, '-').slice(0, 100);
const id = (s) => String(s).slice(0, 120);
const add = (check, level, msg) => findings.push({ check: id(check), level: level, msg: msg });
const check = (checkId, ok, label, miss) => add(checkId, ok ? 'pass' : miss, (ok ? '' : 'missing ') + label);

// Is <alias> present in the hook text as a STANDALONE token? A naive hookText.includes(alias) gave FALSE
// "wired" passes because short aliases are substrings of unrelated words: 'build:latest'.includes('test')
// is true, so a repo that never wired 'test' looked wired. Require the alias to be flanked by a non-
// alphanumeric char (or a string edge) so 'test' matches 'npm test' but not 'latest', while multi-word /
// flag aliases like 'go vet' and '--cov' (whose own edges are non-alphanumeric) still match correctly.
function wired(hookText, alias) {
  const alnum = (ch) => /[a-z0-9]/.test(ch);
  for (let from = 0; ; ) {
    const i = hookText.indexOf(alias, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : hookText[i - 1];
    const after = hookText[i + alias.length] || '';
    if (!alnum(before) && !alnum(after)) return true;
    from = i + 1;
  }
}

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

// The schemaVersion the manifest CLAIMS, hoisted so the report-back body can say which contract this
// run judged. Null when there is no readable manifest at all.
let specVersion = null;
const path = '.ai/manifest.yaml';
if (!existsSync(path)) {
  add('manifest.missing', 'fail', 'missing .ai/manifest.yaml - run the Ascent onboarding skill to scaffold the standard');
} else {
  const text = readFileSync(path, 'utf8');

  // 1. structure
  const schema = kv(text, 'schema');
  const ver = kv(text, 'schemaVersion') || '0';
  specVersion = ver;
  if (schema === 'ai-manifest') add('structure', 'pass', 'manifest schema ok (' + schema + ' v' + ver + ')');
  else add('structure', 'fail', 'manifest schema id is not "ai-manifest"');
  if (ver.split('.')[0] !== '0') add('structure.schema-version', 'warn', 'manifest major v' + ver.split('.')[0] + ' is newer than this doctor (0.x) - update the doctor');

  // 2. pointers resolve - scope to the paths: block so a like-named capability (e.g. an "evals"
  // capability) can't shadow paths.evals via a naive first-match.
  const pathsBlock = (text.split(/\\npaths:\\n/)[1] || '').split(/\\n[a-z]/i)[0];
  const ctxIndex = sub(pathsBlock, 'contextIndex') || '.ai/context-index.json';
  check('pointer.contextindex', existsSync(ctxIndex), 'context index ' + ctxIndex, 'warn');
  check('pointer.memory', existsSync(sub(pathsBlock, 'memory') || '.ai/memory/'), 'memory store', 'warn');
  // Every OTHER pointer the manifest DECLARES must resolve too (guardrails, evals, whatever the repo
  // adds). We deliberately do NOT check for pointers that are absent: this doctor used to warn that
  // 'evals/' was missing on every fresh install, for a subsystem the standard never scaffolds - a
  // guaranteed yellow you had no in-kit way to fix. Declare a pointer and it is enforced; leave it
  // out and it is silent.
  const declared = Object.create(null);
  for (const line of pathsBlock.split('\\n')) {
    const m = line.match(/^\\s+([\\w-]+):\\s*(.+)$/);
    if (!m) continue;
    const key = m[1], val = m[2].trim().replace(/^"|"$/g, '');
    declared[key] = val;
    if (key === 'contextIndex' || key === 'memory') continue;
    check('pointer.' + slug(key), existsSync(val), 'declared path ' + key + ' -> ' + val, 'warn');
  }

  // 2b. GUARDRAILS - the invariants file is machine-checkable, so check the part a machine can: a
  // pattern the repo itself declared as never-commit must not be tracked by git. This is the one
  // guardrail that is a HARD failure, because by the time it trips the secret is already in history.
  const gPath = declared['guardrails'];
  if (gPath && existsSync(gPath)) {
    const never = flow(readFileSync(gPath, 'utf8'), 'neverCommit');
    if (never.length) {
      let tracked = null; // null = git unavailable (shallow tarball, no repo)
      try {
        tracked = execSync('git ls-files -- ' + never.map((p) => JSON.stringify(p)).join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch { tracked = null; }
      if (tracked) add('guardrail.never-commit', 'fail', 'GUARDRAIL VIOLATION: git tracks never-commit file(s): ' + tracked.split('\\n').slice(0, 5).join(', '));
      else if (tracked !== null) add('guardrail.never-commit', 'pass', 'no never-commit secret files are tracked (' + never.length + ' patterns)');
      // Git unavailable: this used to emit NOTHING, so a tarball run and a run that positively cleared
      // the hardest guardrail in the standard produced the same output. Say so instead - the reader is
      // entitled to know the secret check did not happen.
      else add('guardrail.never-commit', 'unchecked', 'never-commit guardrail NOT checked (' + never.length + ' patterns): git is unavailable here (shallow tarball or no repository), so nothing could be compared against the index');
    }
  }

  // 3. capabilities (declared, optionally proven)
  const caps = capabilities(text);
  const names = Object.keys(caps);
  if (names.length) add('capability.declared', 'pass', 'declares ' + names.length + ' capabilities: ' + names.join(', '));
  else add('capability.declared', 'fail', 'no capabilities declared');
  const runResults = {};
  for (const n of names) {
    if (/<.*>/.test(caps[n])) add('capability.' + slug(n), 'warn', 'capability "' + n + '" has a placeholder command - fill it in');
    else if (RUN) {
      // 180000ms = the documented 180s per-capability budget (see the usage banner + the spec). A
      // timeout kill surfaces as e.signal — name it in the finding so a slow-but-green suite reads
      // as "hit the time limit", not as a silent, message-less failure.
      try { execSync(caps[n], { stdio: 'ignore', timeout: 180000 }); add('capability.' + slug(n) + '.run', 'pass', 'verified "' + n + '": ' + caps[n]); runResults[n] = true; }
      catch (e) { add('capability.' + slug(n) + '.run', 'fail', 'capability "' + n + '" FAILED' + (e && e.signal ? ' (killed by ' + e.signal + ' - likely hit the 180s --run timeout)' : '') + ': ' + caps[n]); runResults[n] = false; }
    }
  }
  // --run write-back: "verified" is a CLAIM this doctor PROVES, so flip each run capability's flag to
  // its actual outcome (pass -> true, fail -> false — a stale true never outlives a broken command).
  // The serializer's one-line-per-capability format makes the targeted rewrite safe; placeholder
  // capabilities are never touched. Without this the manifest promised a flip that never happened.
  if (RUN && Object.keys(runResults).length) {
    let updated = text;
    for (const n of Object.keys(runResults)) {
      updated = updated.replace(
        new RegExp('^(\\\\s{2}' + n + ':\\\\s*\\\\{[^\\\\n]*verified:\\\\s*)(true|false)', 'm'),
        function (m, p1) { return p1 + runResults[n]; },
      );
    }
    if (updated !== text) {
      try { writeFileSync(path, updated); add('manifest.write-back', 'pass', 'manifest updated: ' + Object.keys(runResults).map(function (n) { return n + ' verified=' + runResults[n]; }).join(', ')); }
      catch (e) { add('manifest.write-back', 'warn', 'could not write verified flags back to ' + path + ': ' + (e && e.message)); }
    }
  }

  // 4. control placement (shift-left): pre-push is primary, CI is the thin backstop. Check not just
  // that a hook EXISTS, but that each declared & backed pre-push control is actually wired into it.
  const prePush = flow(text, 'prePush');
  const hookFile = ['lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml'].find(existsSync);
  const hasHusky = existsSync('.husky');
  if (prePush.length && !hookFile && !hasHusky) {
    add('control.prepush', 'fail', 'prePush controls declared but NO local hook (lefthook/husky/pre-commit) - they only fire after push');
  } else if (prePush.length) {
    let hookText = hookFile ? readFileSync(hookFile, 'utf8') : '';
    if (hasHusky) for (const f of readdirSync('.husky')) { try { hookText += '\\n' + readFileSync('.husky/' + f, 'utf8'); } catch {} }
    hookText = hookText.toLowerCase();
    const ALIAS = { lint: ['lint', 'eslint', 'ruff', 'biome', 'clippy', 'rubocop'], typecheck: ['typecheck', 'tsc', 'mypy', 'pyright', 'go vet'], test: ['test', 'vitest', 'jest', 'pytest', 'go test'], 'scan-secrets': ['gitleaks', 'trufflehog', 'detect-secrets', 'ggshield'], coverage: ['coverage', '--cov'], format: ['prettier', 'format', 'gofmt', 'rustfmt'] };
    for (const c of prePush) {
      if (!caps[c]) continue; // a missing capability is reported below; don't double-warn
      const al = ALIAS[c] || [c];
      if (!al.some((a) => wired(hookText, a)))
        add('control.prepush.' + slug(c), 'warn', 'pre-push control "' + c + '" is backed but not found in your local hook (' + (hookFile || '.husky') + ') - it may only run in CI (too late). Wire it in.');
    }
  }
  for (const c of prePush) if (!caps[c]) add('control.prepush.' + slug(c) + '.backing', 'warn', 'pre-push control "' + c + '" has no backing capability yet - an onboarding track should add it');
  const ciHard = flow(text, 'ciHardPass');
  const hasCi = existsSync('.github/workflows') && readdirSync('.github/workflows').length > 0;
  if (ciHard.length && !hasCi) add('control.ci', 'warn', 'ciHardPass controls declared but no CI workflows found');

  // 5. freshness - compare each source file's last COMMIT date against generatedAt, NOT its mtime.
  // A git checkout/clone (e.g. actions/checkout in CI, the doctor's primary runtime) rewrites every
  // file's mtime to "now", so an mtime check warns "stale" on every CI run regardless of real drift.
  // Commit dates survive checkouts. If git or the file's history is unavailable (e.g. a shallow clone
  // that didn't fetch the commit that last touched it), commitDate returns '' and we skip the file
  // rather than false-warn.
  const gen = kv(text, 'generatedAt');
  const commitDate = (f) => { try { return execSync('git log -1 --format=%cs -- "' + f + '"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  // Files present but NOT comparable (no generatedAt to compare to, or no commit date available).
  // Skipping them silently made a shallow CI clone read exactly like a repo whose manifest was proven
  // fresh - drift detection is check 5 of the contract, and a run that could not perform it must say
  // so. Reported as ONE aggregated 'unchecked' finding, not one per file: it is a single fact about
  // the run's environment, and a per-file wall would bury the findings that are about the repo.
  const uncomparable = [];
  for (const f of flow(text, 'generatedFrom')) {
    // A <placeholder> is not a file that happens to be absent - it is an UNFILLED field, and the
    // capability check already treats the same marker that way. Skipping it silently (which is what
    // the existsSync guard below did) made a manifest with no provenance at all read exactly like one
    // whose provenance was checked and fresh, which is the whole point of check 5.
    if (/<.*>/.test(f)) {
      add('freshness.' + slug(f), 'warn', 'generatedFrom is still a placeholder (' + f + ') - name the file these commands were derived from, or drift detection cannot run at all');
      continue;
    }
    // A NAMED file that is simply absent stays SILENT on purpose. It is tempting to warn (the
    // provenance would be wrong), but the generator emits a repo-root name and a monorepo can
    // legitimately keep its build manifest in a subdirectory - so the warn would fire on fresh
    // installs its reader could not act on, which is the failure this check is being fixed for.
    if (!existsSync(f)) continue;
    const cd = gen ? commitDate(f) : '';
    if (!cd) { uncomparable.push(f); continue; }
    if (cd > gen)
      add('freshness.' + slug(f), 'warn', 'manifest may be stale: ' + f + ' changed after generatedAt (' + gen + ') - regenerate');
  }
  if (uncomparable.length)
    add('freshness.unchecked', 'unchecked', 'freshness NOT checked for ' + uncomparable.length + ' generatedFrom file(s) (' + (gen ? 'no commit date available - shallow clone or no git history' : 'manifest declares no generatedAt') + '): ' + uncomparable.slice(0, 5).join(', '));
  if (existsSync(ctxIndex)) {
    try {
      for (const m of (JSON.parse(readFileSync(ctxIndex, 'utf8')).modules || [])) {
        if (!m.context) continue;
        if (!existsSync(m.context)) { add('context.' + slug(m.context), 'fail', 'context-index references missing ' + m.context); continue; }
        // A CONTEXT.md that is STILL THE SHIPPED TEMPLATE tells an agent nothing, yet a bare
        // existsSync passes it - the scaffold scoring itself green while empty. Detect the template's
        // own <placeholder> markers: its heading, or several angle-bracket tokens containing a space
        // (real prose and HTML tags rarely do, so this doesn't fire on a genuinely written doc).
        const ctext = readFileSync(m.context, 'utf8');
        const marks = ctext.match(/<[^>\\n]*\\s[^>\\n]*>/g) || [];
        if (/^#\\s*CONTEXT:\\s*<module path>/m.test(ctext) || marks.length >= 3)
          add('context.' + slug(m.context), 'warn', m.context + ' is still the unfilled template (<...> placeholders) - write the real context for ' + (m.path || m.id));
      }
    } catch { add('context.index', 'warn', 'context-index.json is not valid JSON'); }
  }
  // 6. guidance projections - is every vendor guidance file still a projection of the canonical one?
  //
  // The manifest's 'guidance' block names one AUTHORITY and the files generated from it. Each
  // generated file carries a header with two hashes, and the pair separates two very different
  // situations: the canonical moved on and the projection is BEHIND (stale - a warning, nothing is
  // wrong, it is just out of date), versus somebody edited the projection INSTEAD of the source
  // (hand-edited - a failure, because the repo now has two sources of truth and an agent's answer
  // depends on which file it opened, which is the whole thing this block exists to prevent).
  //
  // A repo with no 'guidance' block is NOT failing this check - it has not adopted it. That is
  // reported as 'unchecked', which is a result rather than a silence.
  const gblock = text.split(/\\nguidance:\\n/)[1];
  if (!gblock) {
    add('guidance.unchecked', 'unchecked', 'no guidance block in the manifest - projection drift NOT checked (declare guidance.canonical + projections to enable it)');
  } else {
    const sha12 = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);
    const cm = gblock.match(/^\\s+canonical:\\s*(.+)$/m);
    const canonical = cm ? cm[1].trim().replace(/^"|"$/g, '') : '';
    const canonicalOk = canonical && existsSync(canonical);
    if (!canonicalOk) {
      add('guidance.canonical', 'fail', 'guidance.canonical does not resolve: ' + (canonical || '(not declared)'));
    } else {
      add('guidance.canonical', 'pass', 'canonical guidance is ' + canonical);
    }
    const srcHash = canonicalOk ? sha12(readFileSync(canonical, 'utf8')) : null;
    const declared = [];
    for (const line of gblock.split('\\n')) {
      const m = line.match(/^\\s+-\\s*\\{\\s*agent:\\s*([^,]+),\\s*path:\\s*([^,]+),/);
      if (m) declared.push(m[2].trim().replace(/^"|"$/g, ''));
      else if (/^[^\\s#]/.test(line)) break;
    }
    // The header this reads is the one .ai/maintain.mjs project writes. Keep the two in step.
    const HEADER = /<!--\\s*generated-from:\\s*(\\S+)\\s+sha256:([0-9a-f]{12})\\s*\\u00b7\\s*body:\\s*sha256:([0-9a-f]{12})[^>]*-->/;
    const bodyOf = (t) => {
      let out = t;
      const fm = out.match(/^---\\r?\\n[\\s\\S]*?\\r?\\n---[ \\t]*\\r?\\n/);
      if (fm && fm.index === 0) out = out.slice(fm[0].length);
      const h = out.match(HEADER);
      if (h) out = out.slice(0, h.index) + out.slice(h.index + h[0].length);
      return out.replace(/^(\\r?\\n)+/, '');
    };
    for (const p of declared) {
      if (!existsSync(p)) { add('guidance.' + slug(p), 'fail', 'declared projection is missing: ' + p + ' - run: node .ai/maintain.mjs project'); continue; }
      const t = readFileSync(p, 'utf8');
      const h = t.match(HEADER);
      if (!h) { add('guidance.' + slug(p), 'warn', p + ' is declared a projection but carries no generated-from header - run: node .ai/maintain.mjs project'); continue; }
      if (sha12(bodyOf(t)) !== h[3]) {
        add('guidance.' + slug(p), 'fail', p + ' was HAND-EDITED (its body no longer matches its own hash) - edit ' + canonical + ' and re-run: node .ai/maintain.mjs project');
      } else if (srcHash && h[2] !== srcHash) {
        add('guidance.' + slug(p), 'warn', 'stale projection: ' + p + ' was generated from an older ' + canonical + ' - run: node .ai/maintain.mjs project');
      } else {
        add('guidance.' + slug(p), 'pass', p + ' is in sync with ' + canonical);
      }
    }
    // A guidance file present in the repo but neither the canonical nor a declared projection is an
    // UNGOVERNED second opinion: nothing keeps it in step, so an agent that reads it may get an
    // answer the canonical document contradicts.
    const KNOWN = ['CLAUDE.md', 'AGENTS.md', 'AGENT.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md'];
    for (const p of KNOWN) {
      if (!existsSync(p) || p === canonical || declared.indexOf(p) >= 0) continue;
      add('guidance.' + slug(p), 'warn', p + ' is agent guidance but is neither the canonical source nor a declared projection - declare it under guidance.projections or delete it');
    }
  }

  if (/TODO/.test(text)) add('manifest.todo', 'warn', 'manifest still has TODO placeholders (purpose / secretsFrom / boundaries / agents)');
}

// Weighted pass ratio over the SCORABLE findings this run emitted — the denominator varies with
// --run and with which optional surfaces (hooks, CI) exist, so treat fails/warns as the stable
// numbers and only compare percentages between same-shaped runs (documented in
// docs/features/onboarding/ai-manifest-spec.md).
//
// 'unchecked' findings are excluded from BOTH halves of the ratio. They are not a fourth weight: a
// clause the runner declined to judge is not half-true, and folding it in at any weight would let
// the ABSENCE of evidence move the score. Excluded and COUNTED is the honest pair - the percentage
// stays a ratio over what was actually judged, and 'unchecked' publishes how much wasn't, so the
// spec's "only compare same-shaped runs" rule is checkable from the payload rather than trusted.
const weight = { pass: 1, warn: 0.5, fail: 0 };
const scored = findings.filter(f => f.level !== 'unchecked');
const score = scored.length ? Math.round(100 * scored.reduce((a, f) => a + weight[f.level], 0) / scored.length) : 0;
const icon = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL', unchecked: 'SKIP' };
console.log('\\n.ai conformance - ' + ROOT);
for (const f of findings) console.log('  [' + icon[f.level] + '] ' + f.msg);
const fails = findings.filter(f => f.level === 'fail').length;
const warns = findings.filter(f => f.level === 'warn').length;
const unchecked = findings.length - scored.length;
// 'unchecked' prints even at 0: "0 unchecked" is the statement that this run judged every clause it
// knows about, which is exactly what a reader comparing two percentages needs to establish.
console.log('\\nConformance: ' + score + '%  (' + fails + ' fail, ' + warns + ' warn, ' + unchecked + ' unchecked over ' + scored.length + ' scored)');
if (!RUN) console.log('Tip: re-run with --run to execute and verify capability commands.');
console.log('Then re-scan in Ascent to confirm the maturity delta.');

// --json: machine-readable summary + optional auto-report to Ascent (the adopt->verify->re-score loop).
if (process.argv.includes('--json')) {
  const reportUrl = process.env.ASCENT_CONFORMANCE_URL;
  const reportTok = process.env.ASCENT_CONFORMANCE_TOKEN;
  const reportRepo = process.env.GITHUB_REPOSITORY;
  // Machine-readable SKIP reason: an unattended CI run with report-back half-configured used to be
  // completely silent about it (the setup tip only printed in the human, non---json branch), so the
  // adopt->verify->re-score loop looked closed while Ascent never heard a thing. Additive field -
  // consumers of { score, fails, warns, findings } are unaffected.
  const missing = [!reportUrl && 'ASCENT_CONFORMANCE_URL', !reportTok && 'ASCENT_CONFORMANCE_TOKEN', !reportRepo && 'GITHUB_REPOSITORY'].filter(Boolean);
  // 'unchecked' + 'scored' make the run's SHAPE machine-readable: the score is round(100*Sum/scored),
  // so a consumer can now verify two percentages were computed over the same denominator instead of
  // taking the spec's comparability caveat on faith. Additive per the spec's versioning rule
  // (unknown fields MUST be ignored) - { score, fails, warns, findings } consumers are unaffected,
  // and the exit code below still keys on 'fails' alone, so no adopter's gate changes behaviour.
  const summary = { score: score, fails: fails, warns: warns, unchecked: unchecked, scored: scored.length, specVersion: specVersion, runShape: RUN ? 'run' : 'plain', findings: findings };
  if (missing.length) summary.reportSkipped = 'not reported to Ascent - set ' + missing.join(' + ') + ' (e.g. in CI)';
  process.stdout.write(JSON.stringify(summary) + '\\n');
  if (reportUrl && reportTok && reportRepo && typeof fetch === 'function') {
    try {
      const res = await fetch(reportUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + reportTok },
        // 'unchecked' travels with the score for the same reason it prints: a receiver storing a
        // percentage without its shape cannot compare two of them. Additive - a receiver that does
        // not know the field ignores it (spec rule 3), so older Ascent deployments keep working.
        // The PER-CHECK findings travel now, not just the summary. A score answers "how conformant",
        // which is the question nobody actually asks; "which control regressed" needs the clause-level
        // result, and it was being printed to a CI log and discarded. Still additive per spec rule 3:
        // a receiver that does not know 'findings' stores the same four numbers it always did, and one
        // that does can tell an old reporter (no findings) from a clean run instead of reading a
        // missing check as a pass. 'scored' + 'runShape' travel for the same reason 'unchecked' does -
        // a percentage without its denominator and its shape cannot be compared to another one.
        body: JSON.stringify({
          repo: reportRepo, headSha: process.env.GITHUB_SHA || null,
          score: score, fails: fails, warns: warns, unchecked: unchecked, scored: scored.length,
          specVersion: specVersion, runShape: RUN ? 'run' : 'plain',
          findings: findings.map(function (f) { return { check: f.check, level: f.level, message: f.msg }; }),
        }),
      });
      // fetch only rejects on a network error, never on an HTTP error status - so inspect res.ok and
      // the body. A 401 (bad token), 503 (Ascent DB off), or a 200 with { recorded:false } (repo not
      // watched under its org yet) must NOT print success, or the maintainer believes the adopt->verify
      // loop is closed while the dashboard silently never updates.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) console.error('Conformance report rejected: HTTP ' + res.status + (data && data.error ? ' - ' + data.error : ''));
      else if (data && data.stale) console.error('Conformance report ignored as stale: this commit was already superseded by a newer reported commit, so the dashboard score was not overwritten.');
      else if (data && data.recorded === false) console.error('Conformance report accepted but NOT recorded: this repo is not watched under its org in Ascent yet - watch it, then re-report.');
      else console.log('Reported conformance to Ascent.');
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
