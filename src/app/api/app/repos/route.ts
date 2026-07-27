// GET /api/app/repos?org=<login>   (or ?installation_id=<id>)
// Lists the repositories an installation can access, for the connect UI.

import { NextResponse } from "next/server";
import { isAppConfigured, listInstallationRepos } from "@/lib/github/app";
import { getInstallationIdForOwner, getOrgMovers, getRepoStates, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { normalizeRepoName } from "@/lib/cache";
import { authGateEnabled } from "@/lib/access";
import { requireOrgRead, sessionHasInstallation } from "@/lib/authz";

const MOVERS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30-day movement window for the fleet-map deltas

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Short-TTL payload cache -------------------------------------------------------------------
// Every call here costs a live GitHub App `listInstallationRepos` plus two DB queries (repo states +
// the 30-day movers rollup). The launch fleet map polls this once PER ORG every 90s per open tab, the
// connect + onboarding surfaces hit it on every mount, and React StrictMode double-mounts each of
// those in dev — so N tabs on an M-org fleet multiplied straight through to N×M GitHub round-trips per
// cycle. Caching the assembled payload collapses all of that to one round-trip per org per TTL.
//
// TTL = 30s, deliberately a THIRD of the map's 90s poll: every poll still gets data at most 30s old
// (the map's own cadence dominates the perceived freshness), while the bursty duplicates — parallel
// tabs, a mount immediately followed by a visibility re-pull, StrictMode — collapse onto one call. It
// cannot mask a just-finished scan either: the map defers a scanned org's poll for SCAN_SETTLE_MS
// (120s) and paints those scores from the SSE stream directly.
//
// The entry is keyed by installation id + resolved org login and is populated ONLY AFTER the authz
// gate above has run for this request, so it is a cache of "what this installation can see", never a
// way to skip an authorization check. Bounded + LRU-evicted, mirroring lib/security/supply-chain.ts's
// per-org cache (and lib/cache.ts's own bounded-Map discipline) rather than inventing a new mechanism.
const PAYLOAD_TTL_MS = 30_000;
const PAYLOAD_MAX = 256;
interface ReposPayload {
  installationId: string;
  org: string | undefined;
  repos: unknown[];
}
const payloadCache = new Map<string, { at: number; data: ReposPayload }>();

function payloadCacheGet(key: string): ReposPayload | null {
  const hit = payloadCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= PAYLOAD_TTL_MS) {
    payloadCache.delete(key);
    return null;
  }
  // Refresh LRU recency so a hot org isn't evicted before colder ones (the lib/cache.ts pattern).
  payloadCache.delete(key);
  payloadCache.set(key, hit);
  return hit.data;
}

function payloadCacheSet(key: string, data: ReposPayload): void {
  payloadCache.delete(key);
  if (payloadCache.size >= PAYLOAD_MAX) {
    const oldest = payloadCache.keys().next().value;
    if (oldest) payloadCache.delete(oldest);
  }
  payloadCache.set(key, { at: Date.now(), data });
}

export async function GET(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App is not configured on this deployment." },
      { status: 503 },
    );
  }
  const { searchParams } = new URL(request.url);
  let installationId = searchParams.get("installation_id") ?? undefined;
  const org = (searchParams.get("org") ?? "").trim();

  // Authorize BEFORE minting a token + listing PRIVATE repos: this endpoint returns an
  // installation's full repo list (including private rows), so an unauthorized caller is a
  // cross-tenant IDOR.
  if (authGateEnabled()) {
    // Supabase login wall (the ACTIVE prod auth). The old guard keyed off isAuthConfigured() — the
    // DORMANT custom OAuth — which is inert under the Supabase wall, so requireOrgRead/sessionHas*
    // never fired and ANY caller could list a victim org's private repos (the same IDOR the rest of
    // authz.ts was hardened against). Require a viewer with read standing on the org, then derive the
    // installation FROM the authorized org — a client-supplied ?installation_id= is IGNORED here, so a
    // caller can't pair their own ?org= with a victim's ?installation_id=. All real callers
    // (connect/onboarding/fleet-map) pass ?org=.
    if (!org) {
      return NextResponse.json({ error: "Provide ?org=<login>." }, { status: 400 });
    }
    const gate = await requireOrgRead(org);
    if (gate) return gate;
    installationId = (await getInstallationIdForOwner(org)) ?? undefined;
  } else {
    // Dormant custom OAuth / fully auth-off (local/demo). Resolve the effective installation id and,
    // when custom OAuth IS configured, gate on it being in the session (not the ?org= param), so a
    // caller can't pair their own ?org= with a victim's ?installation_id=.
    if (!installationId && org) {
      installationId = (await getInstallationIdForOwner(org)) ?? undefined;
    }
    if (installationId && isAuthConfigured() && !(await sessionHasInstallation(installationId))) {
      return NextResponse.json(
        { error: "You don't have access to this installation." },
        { status: 403 },
      );
    }
  }
  if (!installationId) {
    return NextResponse.json({ error: "No installation found for that org." }, { status: 404 });
  }

  // Keyed by the AUTHORIZED installation + the requested org, normalized through the repo's canonical
  // owner-name normalizer so `Acme` and `acme` share one entry instead of doubling the GitHub calls.
  // (An empty `org` is a legal key of its own: the login is then derived from the installation's own
  // repos, which is deterministic for that installation.)
  const cacheKey = `${installationId}::${normalizeRepoName(org)}`;
  const cached = payloadCacheGet(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const repos = await listInstallationRepos(installationId);
    repos.sort((a, b) => Number(b.private) - Number(a.private) || a.fullName.localeCompare(b.fullName));
    // Merge stored watch/schedule/level state + a 30-day per-repo overall delta (MAP-3, for the
    // fleet-map movers overlay) — both only when DB + we can resolve the org login.
    const orgLogin = org || repos[0]?.owner;
    const states = isDbConfigured() && orgLogin ? await getRepoStates(orgLogin) : {};
    const movers =
      isDbConfigured() && orgLogin
        ? await getOrgMovers(orgLogin, { start: new Date(Date.now() - MOVERS_WINDOW_MS) }).catch(() => null)
        : null;
    const dByName: Record<string, number> = {};
    if (movers) {
      for (const m of [...movers.gainers, ...movers.regressers, ...movers.levelChanges]) dByName[m.fullName] = m.dOverall;
    }
    const merged = repos.map((r) => ({
      ...r,
      state: states[r.fullName] ?? null,
      dOverall: dByName[r.fullName] ?? null,
    }));
    const payload = { installationId, org: orgLogin, repos: merged };
    // Only a fully-assembled SUCCESS is cached — a 502 below must be retried, not served for 30s.
    payloadCacheSet(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[app/repos] failed", err);
    return NextResponse.json({ error: "Failed to list installation repositories." }, { status: 502 });
  }
}
