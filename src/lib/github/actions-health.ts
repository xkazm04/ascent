// GitHub Actions run health on the default branch — CI as it actually RUNS, not as it is committed
// (deepening pass, 2026-08-17).
//
// D3 reads `.github/workflows/*.yml` and credits "CI runs tests"; it cannot tell a green pipeline from
// one that has been red for a month. `GET /repos/{o}/{r}/actions/runs?branch=<default>` returns the
// recent runs with `conclusion` + timings, readable on public repos with an ordinary token (verified
// live 2026-08-17 on vercel/next.js) and on private repos when the App holds "Actions: read" (optional
// permission — documented, never required; absence degrades to null).
//
// Folded into D3 as ADDITIVE evidence only (analyze/platform-signals.ts): a healthy main earns a
// modest credit and a red main is named in the evidence for the model to weigh, but never subtracted —
// anonymous scans cannot observe this, and a token-gated penalty would make the same repo score lower
// the more you let Ascent see. Null = not observable; `sampled: 0` on a 200 = a real "no Actions runs".

import { fetchWithTimeout, ghHeaders, githubApiBase } from "@/lib/github/host";

export interface CiHealth {
  /** Branch sampled (the default branch). */
  branch: string;
  /** Completed runs considered (after excluding cancelled/skipped/neutral). */
  sampled: number;
  /** success / (success + failure) over `sampled`, 0..100; null when sampled is 0. */
  successRate: number | null;
  /** Median wall-clock of the sampled runs in minutes; null when unknown. */
  medianDurationMin: number | null;
  /** ISO time of the most recent run in the sample; null when none. */
  latestRunAt: string | null;
  /** Distinct workflows seen in the sample. */
  workflows: number;
  /** Workflow names whose MOST RECENT sampled run failed (a currently-red workflow), deduped. */
  failing: string[];
}

const API = githubApiBase();
const TIMEOUT_MS = 10_000;
/** How many recent default-branch runs to sample (one page). */
export const CI_HEALTH_SAMPLE = 50;

/**
 * Conclusions that are NOT a verdict on the pipeline: a human cancelled it, a path filter skipped it,
 * a check reported neutral, GitHub marked it stale, it waits on an approval, or it hasn't concluded.
 * Counting these would drag the success rate down for reasons that say nothing about CI health, so
 * they leave the sample entirely (they shrink the denominator rather than scoring as failures).
 */
const EXCLUDED = new Set(["cancelled", "skipped", "neutral", "stale", "action_required"]);
/** Conclusions that count as a red pipeline. `timed_out`/`startup_failure` are failures, not noise. */
const FAILURE = new Set(["failure", "timed_out", "startup_failure"]);

/** The slice of a workflow-run row this module reads. */
interface RawRun {
  name?: unknown;
  workflow_id?: unknown;
  status?: unknown;
  conclusion?: unknown;
  created_at?: unknown;
  run_started_at?: unknown;
  updated_at?: unknown;
}

/** One run that survived the sampling filter, normalized. */
interface SampledRun {
  key: string;
  name: string;
  failed: boolean;
  createdAt: number;
  createdAtRaw: string | null;
  durationMin: number | null;
}

function ms(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Keep only completed runs whose conclusion is a verdict on the pipeline (see EXCLUDED). */
function sample(rows: RawRun[]): SampledRun[] {
  const out: SampledRun[] = [];
  for (const r of rows) {
    if (r?.status !== "completed") continue;
    const conclusion = typeof r.conclusion === "string" ? r.conclusion.toLowerCase() : null;
    if (!conclusion || EXCLUDED.has(conclusion)) continue;
    const failed = FAILURE.has(conclusion);
    // Anything that is neither a known failure nor a plain success is an unknown verdict — leave it out
    // rather than guessing which way it should count.
    if (!failed && conclusion !== "success") continue;
    const started = ms(r.run_started_at);
    const ended = ms(r.updated_at);
    const durationMin = started !== null && ended !== null && ended >= started ? (ended - started) / 60_000 : null;
    const key = r.workflow_id != null ? `id:${String(r.workflow_id)}` : `name:${String(r.name ?? "")}`;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : key;
    out.push({
      key,
      name,
      failed,
      createdAt: ms(r.created_at) ?? -Infinity,
      createdAtRaw: typeof r.created_at === "string" ? r.created_at : null,
      durationMin,
    });
  }
  return out;
}

/** Median of a non-empty numeric list (mean of the two middles on an even count). */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const hi = s[mid] ?? 0;
  return s.length % 2 ? hi : ((s[mid - 1] ?? hi) + hi) / 2;
}

/**
 * Workflows whose MOST RECENT sampled run failed — "what is red right now", not "what has ever been
 * red". A workflow that failed last week and has been green since is healthy and must not be named.
 * Deduped by name, in API order (newest-first), so the evidence line is stable.
 */
function currentlyFailing(runs: SampledRun[]): string[] {
  const latest = new Map<string, SampledRun>();
  const order: string[] = [];
  for (const r of runs) {
    const prev = latest.get(r.key);
    if (!prev) {
      order.push(r.key);
      latest.set(r.key, r);
    } else if (r.createdAt > prev.createdAt) {
      latest.set(r.key, r);
    }
  }
  const names: string[] = [];
  for (const key of order) {
    const r = latest.get(key)!;
    if (r.failed && !names.includes(r.name)) names.push(r.name);
  }
  return names;
}

/**
 * Read recent default-branch workflow runs and summarise their health. Null on any non-200 or
 * transport failure. `exclude_pull_requests=true` keeps PR-triggered runs out so this measures the
 * branch, not the review queue.
 */
export async function fetchCiHealth(
  owner: string,
  repo: string,
  branch: string,
  token: string,
  signal?: AbortSignal,
): Promise<CiHealth | null> {
  const url =
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs` +
    `?branch=${encodeURIComponent(branch)}&per_page=${CI_HEALTH_SAMPLE}&exclude_pull_requests=true`;
  try {
    const res = await fetchWithTimeout(url, { headers: ghHeaders(token) }, TIMEOUT_MS, signal);
    // 403 = no "Actions: read"; 404 = Actions disabled/private without scope. Both are "not observable"
    // — never a zero success rate, which would read as a repo with broken CI.
    if (res.status !== 200) return null;
    const body = (await res.json().catch(() => null)) as { workflow_runs?: unknown } | null;
    if (!body || typeof body !== "object" || !Array.isArray(body.workflow_runs)) return null;

    const runs = sample(body.workflow_runs as RawRun[]);
    const sampled = runs.length;
    if (sampled === 0) {
      // A real "this branch has no completed Actions runs" — distinct from null (couldn't look).
      return {
        branch,
        sampled: 0,
        successRate: null,
        medianDurationMin: null,
        latestRunAt: null,
        workflows: 0,
        failing: [],
      };
    }

    const success = runs.filter((r) => !r.failed).length;
    const durations = runs.map((r) => r.durationMin).filter((d): d is number => d !== null);
    const latest = runs.reduce<SampledRun | null>(
      (best, r) => (r.createdAtRaw && (!best || r.createdAt > best.createdAt) ? r : best),
      null,
    );

    return {
      branch,
      sampled,
      successRate: Math.round((100 * success) / sampled),
      medianDurationMin: durations.length ? Math.round(median(durations) * 10) / 10 : null,
      latestRunAt: latest?.createdAtRaw ?? null,
      workflows: new Set(runs.map((r) => r.key)).size,
      failing: currentlyFailing(runs),
    };
  } catch {
    return null;
  }
}
