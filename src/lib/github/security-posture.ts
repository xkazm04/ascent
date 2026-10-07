// GitHub-native security posture ingestion (REST) — the security a repo runs through GitHub's
// platform rather than as committed CI-as-code files. The file-based D9 detector (analyze/index.ts)
// can only see workflow/manifest files, so a repo that relies on GitHub-managed security (default
// code scanning, Dependabot, secret scanning — all configured in Settings, not committed) plus a
// coordinated-disclosure program scores near zero despite a genuinely mature posture. This reads the
// public signals of that posture and folds them into D9 (applySecurityPostureSignals).
//
// Both endpoints are readable on PUBLIC repos with an ordinary token — no `security_events` scope and
// no admin: the repo's OWN published advisories, and the org-level SECURITY.md fallback. A failed read REJECTS
// (the ingest's sensorFailed door records it) so a blip never invents a posture.

import type { SecurityPosture } from "@/lib/types";
import { fetchWithTimeout, ghHeaders, githubApiBase } from "@/lib/github/host";

const API = githubApiBase();
const TIMEOUT_MS = 10_000;
const ADVISORY_PAGE = 100; // one page; count is a floor when it fills (rendered "N+")

/** Fetch the repo's published-advisory count + org-level security-policy fallback.
 *  REJECTS when a read failed (network error, timeout, unexpected status, malformed body) so the
 *  caller's sensor-failure door records it; a resolved value is always a successful read. */
export async function fetchSecurityPosture(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<SecurityPosture | null> {
  const [advisories, orgPolicy] = await Promise.all([
    fetchAdvisoryCount(owner, repo, token, signal),
    fetchOrgSecurityPolicy(owner, token, signal),
  ]);
  return { advisoryCount: advisories.count, advisoryCapped: advisories.capped, orgSecurityPolicy: orgPolicy };
}

/** Published GHSAs the repo authored about itself — the coordinated-disclosure maturity signal. */
async function fetchAdvisoryCount(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ count: number; capped: boolean }> {
  const url = `${API}/repos/${owner}/${repo}/security-advisories?state=published&per_page=${ADVISORY_PAGE}`;
  const res = await fetchWithTimeout(url, { headers: ghHeaders(token) }, TIMEOUT_MS, signal);
  // 404 = advisories not enabled / repo has none exposed → a real "zero", not an error.
  if (res.status === 404) return { count: 0, capped: false };
  if (res.status !== 200) throw new Error(`security advisories read failed: HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) throw new Error("security advisories read failed: malformed body");
  return { count: body.length, capped: body.length >= ADVISORY_PAGE };
}

/** Does the owner's `.github` repo carry a SECURITY.md (the org-wide policy every repo inherits)?
 *  A probe that threw or answered other than 200/404 is unknown, not "no": if no path answered 200
 *  and any probe failed, reject. Only all-404 is a real false. */
async function fetchOrgSecurityPolicy(owner: string, token: string, signal?: AbortSignal): Promise<boolean> {
  // GitHub resolves an org-level security policy from owner/.github (root or profile/). The community
  // profile of the target repo does NOT reliably reflect this fallback, so probe the source directly.
  let failure: unknown = null;
  for (const path of ["SECURITY.md", "profile/SECURITY.md", ".github/SECURITY.md"]) {
    try {
      const res = await fetchWithTimeout(
        `${API}/repos/${owner}/.github/contents/${path}`,
        { headers: ghHeaders(token) },
        TIMEOUT_MS,
        signal,
      );
      if (res.status === 200) return true;
      if (res.status !== 404) failure ??= new Error(`org security policy probe failed: HTTP ${res.status}`);
    } catch (err) {
      failure ??= err;
    }
  }
  if (failure) throw failure;
  return false;
}
