// GitHub App write surface for the PR maturity gate: a Check Run (the pass/fail status that can
// block merge) + a sticky PR comment (updated in place, never stacked). Both use the installation
// token and need `checks: write` + `pull_requests: write`. Pure rendering lives in
// scoring/gate-comment.ts; this module only performs the I/O.

import { AppApiError, githubAppFetch } from "@/lib/github/app";

// --- Bounded retry for the Check Run write (ci-gate-status-checks #3) -------------------------------
// createCheckRun was a single un-retried POST: a transient GitHub 5xx/429/network blip threw, and the
// only caller swallowed it inline (`.catch(log)`), so a *required* "Ascent maturity gate" check was left
// PERMANENTLY pending — blocking merge on that PR forever with no status, no comment, no Re-run, no retry
// (GitHub only redelivers on a non-2xx, and we always 2xx). Wrap the write in bounded exponential backoff
// so a momentary hiccup self-heals; on a FINAL failure we still throw (loud) so the caller's neutral-check
// + delivery-release fallback runs instead of silently swallowing it.

// Retryable = transient server / rate-limit statuses. A network failure (fetch throws a TypeError) is also
// transient. Everything else — notably the terminal 401/403/404/422 (bad token, no permission, gone repo,
// GitHub rejected the payload) — is NOT retried: retrying a permission error just burns quota forever.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
const BASE_BACKOFF_MS = 500; // 500ms, 1000ms (× 2 ** attempt)
const MAX_BACKOFF_MS = 8000; // ceiling so a huge Retry-After can't wedge the request for the full maxDuration

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A transient failure worth retrying: a 429/5xx from GitHub, or a network error (fetch → TypeError). A
 *  terminal 401/403/404/422 returns false so we don't retry a permission/validation error indefinitely. */
function isRetryableCheckError(err: unknown): boolean {
  if (err instanceof AppApiError) return RETRYABLE_STATUS.has(err.status);
  return err instanceof TypeError; // fetch network failure
}

/** Honor GitHub's rate-limit back-off when the error carries a Retry-After. AppApiError does NOT currently
 *  surface response headers (githubAppFetch discards them), so this reads an optional `retryAfterSec` field
 *  defensively/forward-compatibly and returns null when absent — the caller then falls back to exponential
 *  backoff. Kept here so that if app.ts ever attaches Retry-After, this path honors it with no other change. */
function retryAfterMs(err: unknown): number | null {
  const ra = (err as { retryAfterSec?: unknown } | null)?.retryAfterSec;
  return typeof ra === "number" && Number.isFinite(ra) && ra >= 0 ? Math.min(ra * 1000, MAX_BACKOFF_MS) : null;
}

/** Run a Check Run write with bounded backoff on transient failures, rethrowing the last error when the
 *  retries are exhausted or the failure is terminal — so the caller can react (post a neutral check, release
 *  the webhook delivery for redelivery) rather than lose the required status silently. */
async function withCheckRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryableCheckError(err)) throw err;
      await sleep(retryAfterMs(err) ?? Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS));
    }
  }
  throw lastErr; // unreachable (the loop either returns or throws), but keeps the type non-optional
}

/** A button GitHub renders on the Check Run; clicking it delivers a `check_run.requested_action`
 *  webhook carrying this `identifier`. label ≤20 chars, description ≤40, identifier ≤20 (GitHub limits). */
export interface CheckRunAction {
  label: string;
  description: string;
  identifier: string;
}

export interface CheckRunInput {
  token: string;
  owner: string;
  repo: string;
  headSha: string;
  name?: string;
  conclusion: "success" | "failure" | "neutral";
  title: string;
  summary: string;
  /** Optional deep link surfaced on the check (e.g. the Ascent report). */
  detailsUrl?: string;
  /** Optional action buttons (e.g. "Re-run") — GitHub posts a `requested_action` webhook on click. */
  actions?: CheckRunAction[];
}

/** Create a completed Check Run on a commit. Returns the run's html_url. Retries transient GitHub
 *  failures (429/5xx/network) with bounded backoff (withCheckRetry); a terminal or exhausted failure
 *  THROWS so the caller can post its neutral fallback + release the delivery — never a silent no-check. */
export async function createCheckRun(input: CheckRunInput): Promise<{ url: string; id: number }> {
  const { token, owner, repo, headSha } = input;
  const run = await withCheckRetry(() =>
    githubAppFetch<{ html_url: string; id: number }>(`/repos/${owner}/${repo}/check-runs`, token, {
      method: "POST",
      body: JSON.stringify({
        name: input.name ?? "Ascent maturity gate",
        head_sha: headSha,
        status: "completed",
        conclusion: input.conclusion,
        ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
        ...(input.actions?.length ? { actions: input.actions.slice(0, 3) } : {}),
        output: { title: input.title, summary: input.summary },
      }),
    }),
  );
  return { url: run.html_url, id: run.id };
}

export interface StickyCommentInput {
  token: string;
  owner: string;
  repo: string;
  /** PR number (PRs are issues for the comments API). */
  prNumber: number;
  /** Hidden marker that identifies a prior bot comment to update. */
  marker: string;
  body: string;
}

/**
 * Upsert a sticky comment on a PR: find the bot's prior comment by `marker` and PATCH it, else
 * POST a new one. Returns the comment's html_url.
 *
 * Ordering (ci-gate-status-checks #3): the issue-comments API returns comments OLDEST-first and the
 * per-issue endpoint supports NO sort/direction override, and editing a comment (PATCH) does not move
 * it — so a sticky comment created when the thread was already long sits at a FIXED, possibly late
 * page. The old code scanned only the first MAX_PAGES=5 pages under a wrong "newest activity is usually
 * early" assumption, so on a PR with >500 comments it never found its own marker and POSTed a brand-new
 * comment on every push — stacking duplicates, the exact thing this upsert exists to prevent. We now
 * scan FORWARD to the natural end of the thread (the first short page), with MAX_PAGES only as a high
 * safety ceiling; the common case still costs a single request via the short-page break below.
 */
export async function upsertStickyComment(input: StickyCommentInput): Promise<{ url: string; updated: boolean }> {
  const { token, owner, repo, prNumber, marker, body } = input;
  const PER_PAGE = 100;
  // Safety ceiling (mirrors listInstallationReposResult): 50×100 = 5000 comments. The loop normally
  // stops far earlier at the first short page — this only bounds a pathological mega-thread.
  const MAX_PAGES = 50;

  let existingId: number | null = null;
  for (let page = 1; page <= MAX_PAGES && existingId == null; page++) {
    const comments = await githubAppFetch<{ id: number; body: string }[]>(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${PER_PAGE}&page=${page}`,
      token,
    );
    const hit = comments.find((c) => typeof c.body === "string" && c.body.includes(marker));
    if (hit) existingId = hit.id;
    if (comments.length < PER_PAGE) break;
  }

  if (existingId != null) {
    try {
      const updated = await githubAppFetch<{ html_url: string }>(
        `/repos/${owner}/${repo}/issues/comments/${existingId}`,
        token,
        { method: "PATCH", body: JSON.stringify({ body }) },
      );
      return { url: updated.html_url, updated: true };
    } catch (err) {
      // The prior comment may have been deleted between read and write — fall through to create.
      if (!(err instanceof AppApiError && err.status === 404)) throw err;
    }
  }

  // No marked comment found (or the prior one was deleted) — create a new one. Under CONCURRENT PR events
  // (two pushes, a synchronize racing a labeled) both handlers can reach here having each seen no marker,
  // and both POST — stacking DUPLICATE bot comments, the exact thing this sticky upsert exists to prevent
  // (ci-gate-status-checks #4). GitHub offers no atomic find-or-create on issue comments, so we make the
  // operation idempotent on the stable `marker` by RECONCILING right after the create.
  const created = await githubAppFetch<{ id: number; html_url: string }>(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    token,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return reconcileStickyComment(input, created.id, created.html_url);
}

/**
 * Converge concurrent sticky-comment creates to a SINGLE comment (ci-gate-status-checks #4). Re-scan the
 * thread for every comment carrying our `marker`: with no race there's exactly one (the one we just
 * created) and this is a no-op single request. Under a race there are ≥2, so keep the EARLIEST (lowest
 * id — GitHub comment ids are monotonic with creation) as canonical and DELETE the rest WE could have
 * created, so racing handlers deterministically agree on the same surviving comment regardless of
 * interleaving. Best-effort deletes (a concurrent reconcile may have already removed one → 404, ignored).
 */
async function reconcileStickyComment(
  input: StickyCommentInput,
  createdId: number,
  createdUrl: string,
): Promise<{ url: string; updated: boolean }> {
  const { token, owner, repo, prNumber, marker } = input;
  const PER_PAGE = 100;
  const MAX_PAGES = 50;
  const marked: { id: number; url: string }[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const comments = await githubAppFetch<{ id: number; body: string; html_url: string }[]>(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${PER_PAGE}&page=${page}`,
      token,
    );
    for (const c of comments) if (typeof c.body === "string" && c.body.includes(marker)) marked.push({ id: c.id, url: c.html_url });
    if (comments.length < PER_PAGE) break;
  }
  // No duplicate (the common, uncontended path) — the comment we created stands.
  if (marked.length <= 1) return { url: createdUrl, updated: false };

  const canonical = marked.reduce((a, b) => (b.id < a.id ? b : a));
  // Delete every duplicate that is NOT the canonical. We only ever created comments with this marker, so
  // deleting the non-canonical marked comments removes the racers' (and possibly our own) extras.
  for (const c of marked) {
    if (c.id === canonical.id) continue;
    await githubAppFetch(`/repos/${owner}/${repo}/issues/comments/${c.id}`, token, { method: "DELETE" }).catch(() => {});
  }
  // Report the surviving canonical comment's URL — it may be an earlier racer's, not ours.
  return { url: canonical.url, updated: false };
}
