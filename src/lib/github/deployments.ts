// GitHub Deployments ingest (W4) — the event that anchors "failure" to something outside git.
//
// Ascent could already say a change was REVERTED (a git fact). It could not say whether anything
// BROKE. DORA's change-failure rate needs a deployment to have happened and to have succeeded or
// not, and GitHub's Deployments API reports exactly that — through the installation token the scan
// already holds. No new vendor, no new auth surface, no new secret.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT "failure" MEANS HERE, PRECISELY.
//
// `state` is the DEPLOYMENT's own latest status. "failure" therefore means *the deployment failed* —
// it does NOT mean "this change caused an incident". Those are different claims, and only the first
// is observable from this API. Every surface that renders these numbers repeats the distinction,
// because "change failure rate" is a term of art that a reader will otherwise hear as the second.
//
// A deployment with NO status is stored as `pending` rather than dropped: it happened, we simply do
// not know how it ended, and dropping it would quietly shrink the denominator of every rate.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const GH = "https://api.github.com";

/** One deployment as we store it. `sha` is lower-cased — the join key to AiChange.mergeCommitSha. */
export interface DeploymentRecord {
  externalId: string;
  environment: string;
  sha: string;
  ref: string | null;
  state: string;
  createdAt: string;
  statusAt: string | null;
}

interface GhDeployment {
  id?: number | string;
  environment?: string;
  sha?: string;
  ref?: string;
  created_at?: string;
}

interface GhDeploymentStatus {
  state?: string;
  created_at?: string;
}

/** The states GitHub's deployment-status API can report. Anything else is normalized to `pending`. */
const KNOWN_STATES = new Set(["success", "failure", "error", "inactive", "in_progress", "queued", "pending"]);

/** Deployment states that count as a FAILED deployment for change-failure rate. */
export const FAILED_STATES: ReadonlySet<string> = new Set(["failure", "error"]);

/**
 * Fold a raw deployment + its latest status into a record. Pure.
 *
 * A missing/unknown status normalizes to `pending` — "we do not know how this ended" — never to
 * `success`, which would understate the failure rate, and never to `failure`, which would invent one.
 */
export function toDeploymentRecord(d: GhDeployment, latest: GhDeploymentStatus | null): DeploymentRecord | null {
  const externalId = d.id != null ? String(d.id) : "";
  const sha = typeof d.sha === "string" ? d.sha.trim().toLowerCase() : "";
  const createdAt = typeof d.created_at === "string" ? d.created_at : "";
  // Without an id, a sha or a timestamp there is nothing to key, join or window on.
  if (!externalId || !sha || !createdAt) return null;
  const raw = (latest?.state ?? "").toLowerCase();
  return {
    externalId,
    environment: (d.environment ?? "unknown").slice(0, 60),
    sha,
    ref: typeof d.ref === "string" ? d.ref.slice(0, 200) : null,
    state: KNOWN_STATES.has(raw) ? raw : "pending",
    createdAt,
    statusAt: typeof latest?.created_at === "string" ? latest.created_at : null,
  };
}

async function ghJson<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${GH}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** How many deployments one scan will page. Bounded: this rides along a scan, it is not the scan. */
export const DEPLOYMENT_PAGE_SIZE = 100;

/**
 * Fetch a repo's recent deployments with their latest status.
 *
 * Costs 1 + N requests (the list, then one status call each), which is why the page size is bounded
 * and the whole thing is best-effort: a repo that does not use GitHub Deployments returns an empty
 * list and the scan is unaffected. A 404/403 (no deployments read scope) yields null → no rows, and
 * the derived reads render "not measured" rather than a zero failure rate.
 */
export async function fetchDeployments(
  owner: string,
  repo: string,
  token: string,
  limit = DEPLOYMENT_PAGE_SIZE,
): Promise<DeploymentRecord[]> {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  const list = await ghJson<GhDeployment[]>(`/repos/${o}/${r}/deployments?per_page=${Math.min(100, limit)}`, token);
  if (!Array.isArray(list) || list.length === 0) return [];

  const out: DeploymentRecord[] = [];
  for (const d of list.slice(0, limit)) {
    if (d.id == null) continue;
    // `?per_page=1` — statuses come newest-first, so the first is the latest.
    const statuses = await ghJson<GhDeploymentStatus[]>(
      `/repos/${o}/${r}/deployments/${encodeURIComponent(String(d.id))}/statuses?per_page=1`,
      token,
    );
    const rec = toDeploymentRecord(d, Array.isArray(statuses) ? (statuses[0] ?? null) : null);
    if (rec) out.push(rec);
  }
  return out;
}
