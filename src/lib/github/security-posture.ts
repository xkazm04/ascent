// GitHub-native security posture ingestion (REST) — the security a repo runs through GitHub's
// platform rather than as committed CI-as-code files. The file-based D9 detector (analyze/index.ts)
// can only see workflow/manifest files, so a repo that relies on GitHub-managed security (default
// code scanning, Dependabot, secret scanning — all configured in Settings, not committed) plus a
// coordinated-disclosure program scores near zero despite a genuinely mature posture. This reads the
// public signals of that posture and folds them into D9 (applySecurityPostureSignals).
//
// Both endpoints are readable on PUBLIC repos with an ordinary token — no `security_events` scope and
// no admin: the repo's OWN published advisories, and the org-level SECURITY.md fallback. Degrades to
// null on any error, exactly like fetchBranchGovernance, so a blip never invents a posture.

import type { SecurityPosture } from "@/lib/types";
import { fetchWithTimeout, ghHeaders, githubApiBase } from "@/lib/github/host";

const API = githubApiBase();
const TIMEOUT_MS = 10_000;
const ADVISORY_PAGE = 100; // one page; count is a floor when it fills (rendered "N+")

/** Fetch the repo's published-advisory count + org-level security-policy fallback. Null on failure. */
export async function fetchSecurityPosture(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<SecurityPosture | null> {
  try {
    const [advisories, orgPolicy] = await Promise.all([
      fetchAdvisoryCount(owner, repo, token, signal),
      fetchOrgSecurityPolicy(owner, token, signal),
    ]);
    // The advisory read is the load-bearing signal; if it couldn't be read at all, treat the whole
    // posture as unknown rather than emitting a confident "no advisories / no program" false negative.
    if (advisories === null) return null;
    return { advisoryCount: advisories.count, advisoryCapped: advisories.capped, orgSecurityPolicy: orgPolicy };
  } catch {
    return null;
  }
}

/** Published GHSAs the repo authored about itself — the coordinated-disclosure maturity signal. */
async function fetchAdvisoryCount(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ count: number; capped: boolean } | null> {
  const url = `${API}/repos/${owner}/${repo}/security-advisories?state=published&per_page=${ADVISORY_PAGE}`;
  const res = await fetchWithTimeout(url, { headers: ghHeaders(token) }, TIMEOUT_MS, signal);
  // 404 = advisories not enabled / repo has none exposed → a real "zero", not an error.
  if (res.status === 404) return { count: 0, capped: false };
  if (res.status !== 200) return null;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return null;
  return { count: body.length, capped: body.length >= ADVISORY_PAGE };
}

/** Does the owner's `.github` repo carry a SECURITY.md (the org-wide policy every repo inherits)? */
async function fetchOrgSecurityPolicy(owner: string, token: string, signal?: AbortSignal): Promise<boolean> {
  // GitHub resolves an org-level security policy from owner/.github (root or profile/). The community
  // profile of the target repo does NOT reliably reflect this fallback, so probe the source directly.
  for (const path of ["SECURITY.md", "profile/SECURITY.md", ".github/SECURITY.md"]) {
    try {
      const res = await fetchWithTimeout(
        `${API}/repos/${owner}/.github/contents/${path}`,
        { headers: ghHeaders(token) },
        TIMEOUT_MS,
        signal,
      );
      if (res.status === 200) return true;
    } catch {
      /* try the next candidate path */
    }
  }
  return false;
}
