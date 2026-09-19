// Single source of truth for the "open a draft PR with an org installation token" route plumbing,
// shared by the four PR-write routes (practices/apply, practices/apply-batch, org/playbooks/[id]/apply,
// report/passport/pr). Each of those routes ran a byte-identical installation gate ("Ascent isn't
// installed on <org>…" 403 → mint the installation token) and an all-but-identical AppApiError/
// GitHubError → HTTP catch. Centralizing both here keeps the security-sensitive customer-repo WRITE
// surface in lockstep: a change to the install-not-found copy, the token mint, or the error taxonomy
// lands once instead of drifting across four catch blocks (it already had — playbooks/apply was
// missing the 409 "won't-overwrite" branch the others carried; this module unifies that).
//
// Scope, deliberately: each route keeps its OWN App-config (503) / session (401) / tenant gate
// (requireOrgAccess / resolvePlaybookOrg / readableOrgForOwner) inline, because those run BEFORE the
// installation gate and their order + per-route messages are load-bearing (e.g. a signed-out caller
// must see the route's own 401, not the tenant gate's). This helper picks up only the order-stable
// tail — install presence + token mint — and the trailing error mapping.

import { NextResponse } from "next/server";
import { AppApiError, getInstallationToken } from "@/lib/github/app";
import { GitHubError } from "@/lib/github/source";
import { getInstallationIdForOwner, isDbConfigured } from "@/lib/db";

const WRITE_REJECTED = "GitHub rejected the write. Check the repo and base branch.";
const NO_WRITE_SCOPE =
  "The installation lacks contents/PR write access. Update the GitHub App's permissions.";
const CONFLICT_DEFAULT =
  "That file already exists in the repo. Ascent won't overwrite it with a starter; edit the existing file instead.";

/**
 * Confirm `org` has the GitHub App installed and mint its short-lived installation token. Returns the
 * token on success, or a ready-to-return 403 NextResponse ("Ascent isn't installed on <org>…") when no
 * installation exists. The `org` value is used verbatim both to look up the installation and in the 403
 * message, so callers pass whatever coordinate their own tenant gate already resolved (the parsed repo
 * owner for practices, the playbook/passport org slug otherwise) to preserve the exact prior string.
 *
 * MUST be called AFTER the route's tenant gate (requireOrgAccess / resolvePlaybookOrg), so a caller
 * without org access never reaches a token mint (the cross-tenant write IDOR guard). `getInstallationToken`
 * can throw an AppApiError — call this inside the route's try so that failure flows to `mapPrWriteError`
 * (or, for the batch route, its own token-mint catch).
 */
export async function requirePrWriteContext(org: string): Promise<{ token: string } | NextResponse> {
  const installId = isDbConfigured() ? await getInstallationIdForOwner(org).catch(() => null) : null;
  if (!installId) {
    return NextResponse.json(
      { error: `Ascent isn't installed on ${org}. Install the GitHub App (with write access) to open PRs.` },
      { status: 403 },
    );
  }
  const token = await getInstallationToken(installId);
  return { token };
}

/**
 * Classify a thrown PR-write error into a status + user-facing message, WITHOUT wrapping it in a
 * NextResponse or handling the "anything else" case — each call site owns its own generic-error
 * message and logging tag for that branch (`null` return here means "not an AppApiError/GitHubError,
 * you handle it"). `AppApiError` → 403/404/409 passed through (else 502) with the matching hint;
 * `GitHubError` → its own status (default 502) + message. The 409 branch (a base-file collision
 * openDraftPr refuses to clobber) is included for every caller — single-sourcing it fixed
 * playbooks/apply, which previously dropped 409 to a 502 "write rejected". `conflict` overrides the
 * 409 hint (passport/pr surfaces the AppApiError's own message instead of the generic "won't
 * overwrite" copy). Shared by {@link mapPrWriteError} (single-error routes, whole-route 500 response)
 * and apply-batch's per-repo worker (aggregates many classified errors into one 200 response).
 */
export function classifyPrWriteError(
  err: unknown,
  opts?: { conflict?: (err: AppApiError) => string },
): { status: number; message: string } | null {
  if (err instanceof AppApiError) {
    const status = err.status === 403 || err.status === 404 || err.status === 409 ? err.status : 502;
    const message =
      status === 409
        ? opts?.conflict
          ? opts.conflict(err)
          : CONFLICT_DEFAULT
        : status === 403
          ? NO_WRITE_SCOPE
          : WRITE_REJECTED;
    return { status, message };
  }
  if (err instanceof GitHubError) {
    return { status: err.status ?? 502, message: err.message };
  }
  return null;
}

/**
 * Map a thrown PR-write error to the route's HTTP response. Delegates the AppApiError/GitHubError
 * classification to {@link classifyPrWriteError}; anything else → a logged generic 500. `genericError`
 * is the route's 500 copy; `conflict` overrides the 409 hint (see classifyPrWriteError).
 */
export function mapPrWriteError(
  err: unknown,
  opts: { tag: string; genericError: string; conflict?: (err: AppApiError) => string },
): NextResponse {
  const classified = classifyPrWriteError(err, opts);
  if (classified) return NextResponse.json({ error: classified.message }, { status: classified.status });
  console.error(`[${opts.tag}] failed`, err);
  return NextResponse.json({ error: opts.genericError }, { status: 500 });
}
