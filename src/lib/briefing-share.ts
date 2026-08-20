// Signed, expiring read-only share tokens for the executive briefing (EXEC-6) — so an owner can send
// a board member a briefing without giving them an account. The token IS the capability: an
// HMAC-signed `{org, range, from, to, exp}` payload (the window travels so the recipient sees the same
// period). The shared page (/share/briefing/[token]) verifies it and re-runs buildExecBriefing
// READ-ONLY, exposing only what the briefing tab shows. Inert without a signing secret. The HMAC
// framing is shared with lib/live-share.ts (WAR-4) via lib/signed-share.ts.
//
// GRANT IDENTITY (expiring-share-links #13). Every mint stamps a random `jti`, exactly as the live
// war-room token does (lib/live-share.ts). Before it, `mintedBy` was the only handle on a link, so the
// only kill switch was demoting the person who minted it — which killed every OTHER link they had ever
// issued, and nobody could answer "does grant n exist, and was it opened". The jti gives each grant an
// identity that is (a) revocable on its own via `briefingShareRevocationKey` and (b) loggable, so the
// mint route and the shared page record `briefing.share.minted` / `briefing.share.opened` against it.
// The token stays stateless: the jti is carried IN the payload, and the revocation lookup is injected
// by the reader (`verifyBriefingShareToken(token, { revoked })`) so this module keeps doing no I/O.
// A token minted before this change carries no jti — it keeps working, with only the TTL and the
// `mintedBy` binding governing it, which is what it always had.
//
// CONTENT INTEGRITY (expiring-share-links #26) — read `briefingFigureDigest` below for the decision.
// In one line: this page is a LIVE RE-RENDER of a frozen period, not a stored document, and it now
// carries a fingerprint of the figures as the sender saw them so the recipient is TOLD when the two
// have parted company instead of quietly reading different numbers from the same URL.

import { createHash, randomUUID } from "node:crypto";
import type { ExecBriefing } from "./org/briefing";
import { resolveShareSecret, signShareToken, verifyShareToken } from "./signed-share";
import { resolveWindow } from "./window";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — a board cycle; shortened from 14d to bound a leaked link's exposure window (briefing-share #5)

/** Signing secret: a dedicated BRIEFING_SHARE_SECRET, else the existing AUTH_SECRET. Null = off. */
function shareSecret(): string | null {
  return resolveShareSecret("BRIEFING_SHARE_SECRET");
}

export function briefingShareEnabled(): boolean {
  return shareSecret() !== null;
}

export interface BriefingShareParams {
  org: string;
  range?: string;
  from?: string;
  to?: string;
  // EXEC #1: the per-client segment scope travels in the signed token so the shared read-only page
  // re-runs buildExecBriefing scoped to the SAME client the owner shared, not the whole org.
  segment?: string;
  // Feature 3b: the tech-stack group KEY travels too, so a "Frontend briefing" share stays scoped.
  stack?: string;
  // briefing-share #5: the GitHub login of the OWNER who minted the link. Carried so the shared page can
  // bind the (otherwise un-revocable) stateless token to that owner's continued authority — when set, the
  // link is honored only while `mintedBy` still holds owner access, so removing/demoting them kills their
  // shared links. Set only under the enforced Supabase wall (where membership is the seeded source of
  // truth); other auth modes leave it undefined and keep the prior stateless behavior.
  mintedBy?: string;
  // Finding B (clock-drift): the RESOLVED window frozen as absolute instants at mint time (ISO strings).
  // Carrying only the range KEY (30d/90d/quarter) let the recipient's page recompute `start` against
  // THEIR clock — a board member opening a "Last 90 days" link days later saw a different 90-day window
  // (different numbers) than the owner shared. `winStart` is the absolute start (null/absent = all-time,
  // no lower bound); `winEnd` is the absolute end — an open-ended relative/all-time end (null = "now") is
  // pinned to the mint instant so post-share scans don't leak in either. On sign these are computed here
  // UNLESS the caller supplies them (see signBriefingShareToken — the mint route must know the window
  // before it signs, so it can fingerprint that same window); on verify they are echoed back. A token minted before this
  // change carries neither → the reader falls back to recomputing (the prior drifting behavior, kept so
  // already-minted live links don't break).
  winStart?: string;
  winEnd?: string;
  // #13: this grant's own identity — a random UUID stamped at mint. Never supplied by a caller on
  // sign (one is generated); echoed back on verify so the reader can check it against the revocation
  // ledger and log the open. Absent on a legacy token.
  jti?: string;
  // #26: the figure fingerprint the SENDER saw, from `briefingFigureDigest`. Supplied by the mint
  // route (the only place that can build the briefing) and echoed back on verify. Absent = a legacy
  // token, or a mint where the briefing build failed — the reader then makes no integrity claim at
  // all rather than a false one.
  fig?: string;
}

/** The frozen absolute window carried by a token: `winStart: null` means all-time (no lower bound). */
export interface FrozenShareWindow {
  winStart: string | null;
  winEnd: string;
}

/**
 * Resolve `{range, from, to}` into the ABSOLUTE instants a share token freezes (Finding B), as ISO
 * strings. Exported so the mint route can build — and fingerprint — the SAME briefing the shared page
 * will render, then hand these instants back to {@link signBriefingShareToken}. An open-ended end
 * (every relative preset, and all-time) is pinned to `now`, so a scan landing after the mint is
 * outside the window rather than silently inside it.
 */
export function freezeShareWindow(p: { range?: string; from?: string; to?: string }, now: Date = new Date()): FrozenShareWindow {
  const w = resolveWindow({ range: p.range, from: p.from, to: p.to });
  return { winStart: w.start ? w.start.toISOString() : null, winEnd: (w.end ?? now).toISOString() };
}

/**
 * Revocation-ledger key for one grant. Namespaced into the SessionRevocation store, the same host
 * `lib/db/org-share.ts` chose for live-share links and for the same two reasons: it is a PERMANENT
 * ledger (AuditLog is swept by retentionAuditDays, and a purged revocation row would silently
 * un-revoke a link), and its arbitrary-string primary key can never collide with a real GitHub login,
 * because logins contain no colon. A version > 0 means "this grant is dead". Revoking one jti touches
 * no session and no other link — which is the whole point: the pre-existing lever revoked the
 * ISSUER's entire set. The owner-gated revoke endpoint that bumps this key is
 * POST /api/org/briefing/share/revoke.
 *
 * This stays here, in the pure token module, rather than moving into the db layer: the shared page and
 * this module both need the NAME of a grant's ledger row without doing (or importing) any I/O. The
 * LOOKUP is the opposite — it has exactly one implementation, `isBriefingShareRevoked` in
 * lib/db/org-share.ts, which imports this function so the namespace string is never retyped.
 */
export function briefingShareRevocationKey(jti: string): string {
  return `briefing-share:${jti}`;
}

/**
 * A stable fingerprint of the QUANTITIES in a briefing — every figure a board reader could quote —
 * ignoring presentation (period title, generation date, repo names, level labels).
 *
 * WHY A FINGERPRINT AND NOT A STORED SNAPSHOT (#26). A shared briefing is a claim about a period, and
 * the recipient must see what the sender saw. Two designs reach that:
 *
 *   • Snapshot the rendered briefing. Immutable and cheap to serve — but it is a NEW STORED ARTIFACT
 *     containing fleet-wide security posture, and this repo has both a retention floor and an on-demand
 *     erasure path (lib/db/retention.ts) that every such artifact must be reachable by. An un-purged,
 *     un-erasable copy of an org's posture surviving an Art.17 erasure is a worse defect than the one
 *     being fixed. It also goes stale invisibly: someone forwards a months-old artifact believing it live.
 *   • Re-run against a pinned scan set. Storage stays flat, but it pins only ONE of the drift sources
 *     (see below) and still drifts when a pinned scan is purged underneath it.
 *
 * This takes a third line, the cheapest honest one: keep the live re-render, and carry a fingerprint of
 * what the sender saw in the (already signed) token. Nothing is stored, so there is nothing to retain or
 * erase, and the failure mode stops being silent — the page states whether the figures still match, and
 * says so loudly when they do not.
 *
 * WHAT ACTUALLY DRIFTS, now that the window is frozen. `getOrgRollup`/`getOrgMovers` bound the current
 * snapshot by the window's end, so a re-scan landing after the mint is ALREADY excluded. What is not
 * window-scoped, and therefore still moves under a recipient: the benchmark corpus (other orgs scanning
 * changes this fleet's percentile), goals, recommendations, the practice-rollout proof, the repo set
 * itself (coverage.total), and retention deleting scans inside the frozen window. A pinned scan set
 * would catch none of those; a digest catches all of them.
 *
 * TRADE-OFF ACCEPTED: on a mismatch the recipient cannot reproduce the sender's exact numbers — they are
 * told the figures moved and to ask for a fresh link. That is strictly worse than a snapshot for
 * reproducibility and strictly better for staleness and erasability, and it is never silent.
 *
 * Truncated to 16 hex chars: this detects accidental drift, it is not a security boundary (the whole
 * payload is already HMAC-signed), and a short value keeps the token URL-friendly.
 */
export function briefingFigureDigest(b: ExecBriefing): string {
  const m = b.maturity;
  const projection = [
    m.overall, m.adoption, m.rigor, m.levelId,
    b.coverage.scanned, b.coverage.total,
    b.periodDelta, b.adoptionRate, b.regressionCount,
    b.movement.up, b.movement.down, b.movement.compared,
    b.valueRealized.recsEngaged, b.valueRealized.recsActioned, b.valueRealized.pointsMoved, b.valueRealized.reposPromoted,
    b.benchmark ? [b.benchmark.percentile, b.benchmark.corpusRepos, b.benchmark.corpusAvgOverall,
      b.benchmark.cohort ? [b.benchmark.cohort.repos, b.benchmark.cohort.overallPercentile, b.benchmark.cohort.adoptionPercentile] : null] : null,
    b.priorPeriod ? [b.priorPeriod.overall, b.priorPeriod.adoption, b.priorPeriod.rigor,
      b.priorPeriod.dims.map((d) => [d.dimId, d.now, d.prior])] : null,
    b.strengths.map((d) => [d.dimId, d.avg]),
    b.risks.map((d) => [d.dimId, d.avg]),
    b.security ? [b.security.dimId, b.security.avg] : null,
    b.topGainers.map((x) => [x.name, x.dOverall]),
    b.topRegressions.map((x) => [x.name, x.dOverall]),
    b.goals.map((g) => [g.label, g.current, g.target]),
    b.forecastHeadline, b.forecastConfidence,
    b.engineMix.map((e) => [e.provider, e.count]),
    b.proof ? [b.proof.open, b.proof.merged, b.proof.lift, b.proof.liftPractices] : null,
    (b.recommendations ?? []).map((r) => r.title),
  ];
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex").slice(0, 16);
}

/** What the shared page should tell its reader about the figures below. See {@link briefingFigureDigest}. */
export type ShareIntegrity = "unverifiable" | "unchanged" | "changed";

/**
 * Compare the sender's fingerprint against the one just rendered. `"unverifiable"` (no fingerprint on
 * the token) is the LEGACY answer and must stay distinct from `"unchanged"` — claiming figures match
 * when nothing was compared would be exactly the silent falsehood this is here to remove.
 */
export function shareIntegrity(minted: string | undefined, rendered: string): ShareIntegrity {
  if (!minted) return "unverifiable";
  return minted === rendered ? "unchanged" : "changed";
}

/**
 * Mint a `payload.sig` token carrying the org + window, valid for `ttlMs`. Null without a secret.
 * Returns the grant's `jti` too (#13) so the caller can log it and later revoke THIS link alone.
 */
export function signBriefingShareToken(p: BriefingShareParams, ttlMs: number = DEFAULT_TTL_MS): { token: string; expiresAt: number; jti: string } | null {
  const secret = shareSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + ttlMs;
  // #13: one identity per grant, generated here so no caller can mint two links sharing a kill switch.
  const jti = randomUUID();
  // Finding B: freeze the resolved window into the payload NOW (mint time) so "the window travels" —
  // the recipient re-runs the exact period the owner shared instead of resolveWindow re-floating it to
  // their clock on read. An open-ended end (null = "now", i.e. every relative preset + all-time) is
  // pinned to the mint instant. Range key + from/to still travel too, for the human title label and so a
  // legacy reader that ignores winStart/winEnd still resolves something.
  //
  // #26: a caller-supplied frozen window IS honored (it was previously always recomputed here). The
  // mint route needs the instants BEFORE it signs, because it builds the briefing over exactly this
  // window to fingerprint it — recomputing here would move `winEnd` by the milliseconds between the two
  // calls and could fingerprint a window the token doesn't carry. `winEnd` present is the signal; a
  // caller that supplies nothing gets the computed freeze, unchanged.
  const frozen: FrozenShareWindow = p.winEnd ? { winStart: p.winStart ?? null, winEnd: p.winEnd } : freezeShareWindow(p);
  const { winStart, winEnd } = frozen;
  const token = signShareToken(
    { org: p.org.toLowerCase(), range: p.range, from: p.from, to: p.to, winStart, winEnd, segment: p.segment, stack: p.stack, mintedBy: p.mintedBy, jti, fig: p.fig, exp: expiresAt },
    secret,
  );
  return { token, expiresAt, jti };
}

/**
 * Verify a share token: signature must match (timing-safe), it must not be expired, and — when the
 * reader supplies `opts.revoked` and the token carries a `jti` (#13) — that specific grant must not
 * have been revoked. The predicate is INJECTED rather than looked up here (the live-share module's
 * shape) so this stays pure and does no I/O; the shared page resolves it against the revocation
 * ledger keyed by {@link briefingShareRevocationKey} and fails closed on a lookup error.
 */
export function verifyBriefingShareToken(token: string, opts: { revoked?: (jti: string) => boolean } = {}): BriefingShareParams | null {
  const p = verifyShareToken(token, shareSecret()) as {
    org?: unknown;
    range?: unknown;
    from?: unknown;
    to?: unknown;
    winStart?: unknown;
    winEnd?: unknown;
    segment?: unknown;
    stack?: unknown;
    mintedBy?: unknown;
    jti?: unknown;
    fig?: unknown;
    exp?: unknown;
  } | null;
  if (!p) return null;
  if (typeof p.org !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  const jti = typeof p.jti === "string" ? p.jti : undefined;
  // #13: the per-link kill switch. Only a token that CARRIES a jti can be revoked individually — a
  // legacy one has no handle, so it stays governed by its TTL and the `mintedBy` binding, as before.
  if (jti && opts.revoked?.(jti)) return null;
  return {
    org: p.org,
    range: typeof p.range === "string" ? p.range : undefined,
    from: typeof p.from === "string" ? p.from : undefined,
    to: typeof p.to === "string" ? p.to : undefined,
    // Finding B: the frozen absolute window. `winEnd` being a string is the signal that this token
    // froze its window (always set on new tokens, incl. all-time); its ABSENCE marks a legacy token so
    // the reader falls back to recomputing. `winStart` is absent/non-string for an all-time (null) start.
    winStart: typeof p.winStart === "string" ? p.winStart : undefined,
    winEnd: typeof p.winEnd === "string" ? p.winEnd : undefined,
    segment: typeof p.segment === "string" ? p.segment : undefined,
    stack: typeof p.stack === "string" ? p.stack : undefined,
    mintedBy: typeof p.mintedBy === "string" ? p.mintedBy : undefined,
    jti,
    fig: typeof p.fig === "string" ? p.fig : undefined,
  };
}
