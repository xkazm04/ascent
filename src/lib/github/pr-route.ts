// Single source of truth for the "open a draft PR with an org installation token" route plumbing,
// shared by every PR-write route (practices, ai-stance, admission, playbooks, foundation, passport).
// Each of those routes once ran a byte-identical installation gate ("Ascent isn't
// installed on <org>…" 403 → mint the installation token) and an all-but-identical AppApiError/
// GitHubError → HTTP catch. Centralizing both here keeps the security-sensitive customer-repo WRITE
// surface in lockstep: a change to the install-not-found copy, the token mint, or the error taxonomy
// lands once instead of drifting across four catch blocks (it already had — playbooks/apply was
// missing the 409 "won't-overwrite" branch the others carried; this module unifies that).
//
// Scope: each route keeps its OWN App-config (503) / session (401) / role gate inline, because those
// run BEFORE the installation gate and their order + per-route messages are load-bearing (a
// signed-out caller must see the route's own 401, not the tenant gate's).
//
// THE ONE DOOR (requirePrWriteTarget). What a route may NOT keep inline any more is the step that
// joins the gated org to the repository it writes. `requirePrWriteContext(org: string)` mints a
// token for whatever string it is handed, and the org and the repo owner are both plain strings, so
// a route could gate one and mint for the other and still type-check. /api/org/ai-stance/apply did
// exactly that: it gated `body.org` and minted for the repo's parsed owner, opening a draft PR in
// another tenant's repository with THAT tenant's installation token. requirePrWriteTarget takes the
// gated org and the raw coordinate together, enforces a NAMED tenancy rule, and returns the token
// (always minted for the gated org) beside the coordinate the writer must use (always the parsed
// repo, never the org). `pr-write-target.guard.test.ts` pins which routes may still mint by hand.

import { NextResponse } from "next/server";
import { AppApiError, getInstallationToken } from "@/lib/github/app";
import { GitHubError, parseRepoUrl, type ParsedRepo } from "@/lib/github/source";
import { getInstallationIdForOwner, isDbConfigured } from "@/lib/db";
import { orgTracksRepo } from "@/lib/db/org-admission";

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
 * without org access never reaches a token mint (the cross-tenant write IDOR guard). A NEW route does
 * not call this directly: it calls {@link requirePrWriteTarget}, which binds the mint to the gated org.
 * Direct callers are the allow-listed routes in pr-write-target.guard.test.ts. `getInstallationToken`
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
 * How a coordinate proves it belongs to the gated org. Every in-context route states one by name, so
 * the policy is greppable and a change to it is a one-word diff:
 *  - `owner-namespace`: the repo's owner IS the org slug (practices, ai-stance). The strict rule.
 *  - `tracked`: the owner is the org, OR the org tracks the repo under another namespace (admission;
 *    UAT PRIYA-L2-C5, org `kiro` over `xkazm04/*`). See {@link repoUnderOrg}.
 */
export type PrWriteRule = "owner-namespace" | "tracked";

/** A write coordinate resolved against the gated org. `owner` is lower-cased; `repo` keeps its case. */
export interface PrWriteCoordinate {
  /** The caller's own spelling, for per-row error lines. */
  raw: string;
  owner: string;
  repo: string;
  fullName: string;
  /** The parsed coordinate (owner lower-cased) for writers that take a ParsedRepo. */
  parsed: ParsedRepo;
}

/** One coordinate plus the gated org's installation token. */
export interface PrWriteTarget extends PrWriteCoordinate {
  /** The gated org, lower-cased: the org the token was minted for. */
  org: string;
  token: string;
}

/** Many coordinates under one gated org and ONE token (the fleet routes). */
export interface PrWriteBatchTarget {
  org: string;
  token: string;
  targets: PrWriteCoordinate[];
}

/** `owner/name` or null. Shape only: this makes no claim about who the repo belongs to. */
export function parseRepoFullName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const full = raw.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(full) ? full : null;
}

/**
 * The repo name a caller supplied, constrained to the org that was just gated. Returns null when the
 * shape is wrong OR when the repository does not belong to this org: the gate-then-constrain half
 * that a structural test cannot check for us.
 *
 * TENANCY IS THE ORG'S REPO SET, NOT A STRING PREFIX (UAT `PRIYA-L2-C5`). This used to require
 * `owner === org`, which is true only of an organization whose slug equals its GitHub owner
 * namespace. Every org named for its team rather than its account failed it: on this host, `kiro`
 * could never admit its own `xkazm04/*` repositories. The prefix was never the authority anyway;
 * `orgTracksRepo` reads the `(orgId, fullName)` key that is, so a repo belonging to another tenant
 * still matches nothing. The prefix survives as a FAST PATH ahead of the read, because it can never
 * be wrong in the direction that matters.
 *
 * Lives here (moved from the admission route) because it is the `tracked` rule of
 * {@link requirePrWriteTarget}; the admission routes still call it for their early 400.
 */
export async function repoUnderOrg(org: string, raw: unknown): Promise<string | null> {
  const full = parseRepoFullName(raw);
  if (!full) return null;
  const [owner] = full.split("/");
  if (owner?.toLowerCase() === org.toLowerCase()) return full;
  return (await orgTracksRepo(org, full)) ? full : null;
}

async function underOrg(org: string, parsed: ParsedRepo, rule: PrWriteRule): Promise<boolean> {
  if (parsed.owner.toLowerCase() === org) return true;
  if (rule === "owner-namespace") return false;
  return (await repoUnderOrg(org, `${parsed.owner}/${parsed.repo}`)) !== null;
}

function toCoordinate(raw: string, parsed: ParsedRepo): PrWriteCoordinate {
  const owner = parsed.owner.toLowerCase();
  return { raw, owner, repo: parsed.repo, fullName: `${owner}/${parsed.repo}`, parsed: { ...parsed, owner } };
}

/**
 * The tenancy half of {@link requirePrWriteTarget}, with no installation lookup and no mint. For a
 * route that must refuse a foreign coordinate before a zero-write preview.
 */
export async function resolvePrWriteCoordinate(
  gatedOrg: string,
  rawRepo: string,
  rule: PrWriteRule,
): Promise<PrWriteCoordinate | NextResponse> {
  const org = gatedOrg.trim().toLowerCase();
  const parsed = parseRepoUrl(rawRepo);
  if (!parsed) return NextResponse.json({ error: "Provide repo as 'owner/name'." }, { status: 400 });
  if (!(await underOrg(org, parsed, rule))) {
    return NextResponse.json({ error: `That repository doesn't belong to ${org}.` }, { status: 403 });
  }
  return toCoordinate(rawRepo, parsed);
}

/**
 * THE door for an in-context customer-repo write. Parses the caller's coordinate(s), enforces `rule`
 * against `gatedOrg`, and only then looks up the installation and mints the token, FOR `gatedOrg`
 * and nothing else. The writer must take `owner`/`repo` from the result, never the org.
 *
 * Refusals (ready-to-return NextResponse): 400 for an unparseable coordinate; 403 "That repository
 * doesn't belong to <org>." (a batch: "Not repositories of <org>: …") BEFORE any installation
 * lookup; then requirePrWriteContext's install-missing 403. MUST run after the route's role gate on
 * `gatedOrg`. A token-mint failure throws AppApiError, so call it inside the route's try.
 *
 * A route that previews before writing (HITL) calls {@link resolvePrWriteCoordinate} first, so a
 * foreign coordinate is refused before any bytes are rendered and a preview never mints.
 */
export async function requirePrWriteTarget(
  gatedOrg: string,
  rawRepo: string,
  rule: PrWriteRule,
): Promise<PrWriteTarget | NextResponse>;
export async function requirePrWriteTarget(
  gatedOrg: string,
  rawRepos: readonly string[],
  rule: PrWriteRule,
): Promise<PrWriteBatchTarget | NextResponse>;
export async function requirePrWriteTarget(
  gatedOrg: string,
  raw: string | readonly string[],
  rule: PrWriteRule,
): Promise<PrWriteTarget | PrWriteBatchTarget | NextResponse> {
  const org = gatedOrg.trim().toLowerCase();
  if (typeof raw === "string") {
    const coordinate = await resolvePrWriteCoordinate(org, raw, rule);
    if (coordinate instanceof Response) return coordinate;
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;
    return { ...coordinate, org, token: ctx.token };
  }
  const targets: PrWriteCoordinate[] = [];
  const foreign: string[] = [];
  for (const one of raw) {
    const parsed = parseRepoUrl(one);
    if (!parsed) return NextResponse.json({ error: `Not an 'owner/name' repository: ${one}.` }, { status: 400 });
    if (await underOrg(org, parsed, rule)) targets.push(toCoordinate(one, parsed));
    else foreign.push(one);
  }
  if (foreign.length > 0) {
    return NextResponse.json({ error: `Not repositories of ${org}: ${foreign.slice(0, 5).join(", ")}.` }, { status: 403 });
  }
  const ctx = await requirePrWriteContext(org);
  if (ctx instanceof Response) return ctx;
  return { org, token: ctx.token, targets };
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
