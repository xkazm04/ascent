#!/usr/bin/env node
// Maturity gate for CI — fail the build when a repo is below the maturity bar.
//
//   node scripts/maturity-gate.mjs owner/repo [options]
//   ASCENT_URL=https://your-deploy node scripts/maturity-gate.mjs owner/repo
//
// Options (all optional; unset ones fall back to the archetype-aware default policy):
//   --min-level L3        minimum overall maturity level
//   --min-overall 60      minimum overall score (0..100)
//   --min-dimension 40    no dimension may score below this
//   --min-security 50     minimum Security (D9) score — the security gate floor
//   --no-ungoverned       fail if the posture is "ungoverned" (heavy AI, light guardrails)
//   --require-protection  fail if the default branch has no branch-protection rules (when readable)
//   --min-ai-governed 100 minimum % of AI-attributed merged PRs with an approving human review
//   --no-ungoverned-ai    shorthand for --min-ai-governed 100 (the ungoverned-AI-change gate).
//                         Both are SKIPPED when the repo has no token or fewer than 5 AI PRs — an
//                         unmeasurable repo is never failed on a provenance bar.
//   --ref <sha|branch>    gate a specific ref (e.g. a PR head sha) instead of the default branch
//   --live                score with the configured LLM instead of the deterministic mock
//
// Exit codes: 0 = pass, 1 = fail (below the bar), 2 = error. Hits GET /api/gate, which
// already returns 200/422 — this wrapper just turns that into a clean CI exit + summary.
//
// PRIVATE REPOS: /api/gate is unauthenticated by design (CI calls it with plain curl), so it never
// ingests a repo with an operator token — a private repo simply isn't publicly readable and answers
// 404. Private repos are gated by the Ascent GitHub App's CHECK RUN instead; see the 404 branch
// below, which says so rather than leaving an operator staring at an unexplained error exit.

import { appendFileSync } from "node:fs";

// Step outputs for the composite action (action.yml maps these to its own `outputs:`). Without them a
// consumer workflow could only branch on the exit code — it could not post its own comment, set a
// label, or record the score, because the verdict never left this process. Written on EVERY exit path,
// including the error ones, so `status` always says what happened; the runner reads $GITHUB_OUTPUT
// after the step regardless of its exit code. A no-op outside Actions (the env var is unset locally).
// Every value here is a single-line scalar, which is what the plain `key=value` form requires.
function setOutputs(out) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  try {
    appendFileSync(file, `${Object.entries(out).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  } catch (err) {
    console.error(`  (could not write step outputs: ${err?.message ?? err})`);
  }
}

/** `status` is the single output worth branching on: pass | fail | degraded | not-found | rate-limited | error. */
const outcome = (status, body = {}) =>
  setOutputs({
    status,
    pass: status === "pass",
    degraded: status === "degraded",
    level: body.level ?? "",
    overall: body.overallScore ?? "",
    posture: body.posture ?? "",
  });

const argv = process.argv.slice(2);
const repo = argv.find((a) => !a.startsWith("--"));
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
  outcome("error");
  console.error("Usage: node scripts/maturity-gate.mjs owner/repo [--min-level L3] [--min-dimension 40] [--no-ungoverned] [--live]");
  process.exit(2);
}

const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const base = (process.env.ASCENT_URL || "http://localhost:3000").replace(/\/$/, "");
const qs = new URLSearchParams();
if (opt("min-level")) qs.set("min_level", opt("min-level"));
if (opt("min-overall")) qs.set("min_overall", opt("min-overall"));
if (opt("min-dimension")) qs.set("min_dimension", opt("min-dimension"));
if (opt("min-security")) qs.set("min_security", opt("min-security"));
if (flag("no-ungoverned")) qs.set("no_ungoverned", "1");
if (flag("require-protection")) qs.set("require_protection", "1");
if (opt("min-ai-governed")) qs.set("min_ai_governed", opt("min-ai-governed"));
else if (flag("no-ungoverned-ai")) qs.set("no_ungoverned_ai", "1");
if (flag("live")) qs.set("mock", "0");
// --ref <sha|branch>: gate a specific ref (e.g. a PR head) so the score reflects what the PR
// changes, not the default branch. In a PR workflow: --ref "$GITHUB_SHA" or the PR head sha.
if (opt("ref")) qs.set("ref", opt("ref"));

const url = `${base}/api/gate/${repo}${qs.toString() ? `?${qs}` : ""}`;

try {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  // A DEGRADED verdict (503): the endpoint asked for the real AI grade, the provider was unavailable, and
  // the scan fell back to the deterministic floor. Report it as an ERROR (exit 2, "the gate could not
  // run"), never as a failure (exit 1, "the repo is below the bar") — they mean opposite things to a human
  // triaging a red check. Before the gate surfaced this, a fabricated floor score could pass CI silently.
  if (body.degraded) {
    console.error(`✖ Gate could not produce an authoritative grade for ${repo} — ${body.error ?? "the AI grade was unavailable"}`);
    // Name the REAL remedy: there is no --mock flag (the deterministic rubric is the DEFAULT), so the
    // fix is to DROP --live. The old text advertised a flag this script never parsed, leaving the
    // operator to discover by trial that it did nothing.
    console.error(`  engine: ${body.engine?.provider ?? "?"} (expected a real provider); retry, or drop --live to gate on the deterministic rubric (the default).`);
    for (const w of body.warnings ?? []) console.error(`  - ${w}`);
    outcome("degraded", body);
    process.exit(2);
  }
  // 404 — the repo is not publicly readable. Overwhelmingly this means a PRIVATE repo, the most
  // common enterprise shape, which this endpoint deliberately cannot gate (it never uses an operator
  // token, so it cannot see private repos at all). Exit 2 ("the gate could not run"), never 1 ("below
  // the bar"), and say exactly where a private repo IS gated instead of failing mysteriously.
  if (res.status === 404) {
    console.error(`✖ Gate could not read ${repo} — ${body.error ?? "not found or not publicly readable"}`);
    console.error(`  PRIVATE repositories are gated by the Ascent GitHub App's CHECK RUN, not this endpoint:`);
    console.error(`  install the App on the repository and require its check in your branch-protection rules.`);
    console.error(`  If the repository is public, check the owner/repo spelling and that ASCENT_URL points at your deployment (${base}).`);
    outcome("not-found");
    process.exit(2);
  }
  // 429 — the endpoint throttled us (the ?mock=0 path and every cache-missing ingest are rate-limited).
  // A throttle means the repo was NEVER SCORED, so it belongs with 404/503 in the "gate could not run"
  // class (exit 2), not with "below the bar" (exit 1). Without this branch a 429 fell through to the
  // verdict read below, where `body.pass` is undefined — printing a FAILED line full of "?" placeholders
  // and exiting 1, i.e. blaming the repo for the operator's rate limit.
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    console.error(`✖ Gate is rate-limited for ${repo} — ${body.error ?? "too many requests"}`);
    console.error(
      `  The repository was not scored, so this is not a verdict.${retryAfter ? ` Retry after ${retryAfter}s.` : " Retry shortly."}`,
    );
    outcome("rate-limited");
    process.exit(2);
  }
  if (res.status >= 500) {
    console.error(`✖ Gate error (${res.status}): ${body.error ?? "unknown"}`);
    outcome("error", body);
    process.exit(2);
  }
  // Only 200 (pass) and 422 (fail) carry a VERDICT. Anything else that reached here is an unexpected
  // response, and reading `body.pass` off it would silently report "below the bar" for something that
  // never produced a bar — the same misattribution the 404/429/503 branches above exist to prevent.
  // Closing the class, not just the known members.
  if (res.status !== 200 && res.status !== 422) {
    console.error(`✖ Gate returned an unexpected status ${res.status} for ${repo}: ${body.error ?? "no explanation given"}`);
    console.error(`  No verdict was produced. Check that ASCENT_URL points at an Ascent deployment (${base}).`);
    outcome("error", body);
    process.exit(2);
  }
  const at = body.ref ? `@${String(body.ref).slice(0, 12)}` : "";
  const head = `${repo}${at} — ${body.level ?? "?"} (${body.overallScore ?? "?"}/100), posture ${body.posture ?? "?"}`;
  if (body.pass) {
    console.log(`✓ Maturity gate PASSED — ${head}`);
    outcome("pass", body);
    process.exit(0);
  }
  console.error(`✖ Maturity gate FAILED — ${head}`);
  for (const f of body.failures ?? []) console.error(`  - ${f.message}`);
  outcome("fail", body);
  process.exit(1);
} catch (err) {
  console.error(`✖ Could not reach ${url}: ${err?.message ?? err}`);
  outcome("error");
  process.exit(2);
}
