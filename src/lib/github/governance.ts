// Default-branch governance + commit-activity ingestion (REST).
//
// Both are read-only accessible on public repos with a token:
//   - branch `protected` flag + the rulesets API (`/rules/branches/{branch}`), which returns
//     the *active* rules (pull_request, required_status_checks, signatures, …) without admin.
//   - `/stats/commit_activity` — 52 weeks of commit volume (may 202 on first call → one retry).

import type { Governance } from "@/lib/types";

const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ascent-maturity-scanner",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getJson(
  url: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Merge the per-call timeout with the caller's signal (client disconnect) so the fetch is
  // aborted by whichever fires first.
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    const res = await fetch(url, { headers: headers(token), signal: combined });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

interface Rule {
  type: string;
  parameters?: Record<string, unknown>;
}

/** Fetch the default branch's protection posture (branch flag + applied rulesets). */
export async function fetchBranchGovernance(
  owner: string,
  repo: string,
  branch: string,
  token: string,
  signal?: AbortSignal,
): Promise<Governance | null> {
  try {
    const [branchRes, rulesRes] = await Promise.all([
      getJson(`${API}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, token, signal),
      getJson(`${API}/repos/${owner}/${repo}/rules/branches/${encodeURIComponent(branch)}`, token, signal),
    ]);

    const isProtected = Boolean((branchRes.body as { protected?: boolean } | null)?.protected);
    const rules: Rule[] = Array.isArray(rulesRes.body) ? (rulesRes.body as Rule[]) : [];
    const byType = (t: string) => rules.find((r) => r.type === t);

    const pr = byType("pull_request");
    const params = (pr?.parameters ?? {}) as {
      required_approving_review_count?: number;
      require_code_owner_review?: boolean;
    };

    const readable = branchRes.status === 200 || rulesRes.status === 200;
    if (!readable) return null;

    return {
      defaultBranch: branch,
      protected: isProtected,
      requiresPullRequest: !!pr,
      requiredApprovals: params.required_approving_review_count ?? 0,
      requiresCodeOwnerReview: !!params.require_code_owner_review,
      requiresStatusChecks: !!byType("required_status_checks"),
      requiresSignatures: !!byType("required_signatures"),
      linearHistory: !!byType("required_linear_history"),
      ruleCount: rules.length,
      readable: true,
    };
  } catch {
    return null;
  }
}

/**
 * Last `weeks` weekly commit totals (oldest→newest), or null if unavailable.
 *
 * /stats/commit_activity returns 202 while GitHub computes the stats on a cold cache. Large /
 * recently-active repos routinely keep returning 202 for several seconds, so a single short
 * retry frequently still gets 202 and the sparkline silently vanishes on exactly the busiest
 * repos. Use a small bounded backoff (3 retries, increasing delay) and, on persistent 202,
 * warn loudly instead of returning a silent null.
 */
export async function fetchCommitActivity(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
  weeks = 12,
): Promise<number[] | null> {
  const url = `${API}/repos/${owner}/${repo}/stats/commit_activity`;
  const DELAYS_MS = [1200, 2000, 3000]; // waited AFTER a 202, before the next attempt
  try {
    for (let attempt = 0; ; attempt++) {
      // Bail out of the 202 retry/backoff loop the moment the client goes away.
      if (signal?.aborted) return null;
      const { status, body } = await getJson(url, token, signal);
      if (status === 202) {
        if (attempt >= DELAYS_MS.length) {
          console.warn(
            `[governance] commit_activity still computing (202) for ${owner}/${repo} after ${attempt} retries — omitting sparkline`,
          );
          return null;
        }
        await new Promise((r) => setTimeout(r, DELAYS_MS[attempt]));
        continue;
      }
      if (status !== 200 || !Array.isArray(body)) return null;
      const totals = (body as { total: number }[]).map((w) => w.total ?? 0);
      return totals.slice(-weeks);
    }
  } catch {
    return null;
  }
}
