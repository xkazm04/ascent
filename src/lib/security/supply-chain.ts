// Supply-chain (Dependabot) scanning — a SEPARATE security signal surfaced alongside the D9 score,
// never folded into it (the deterministic rubric stays clean; advisory counts are live facts). Built
// behind a provider abstraction (like the LLM providers): a real GitHub implementation, a deterministic
// `mock` for demo/tests, and `off` (default). Selected via SUPPLY_CHAIN_PROVIDER. Goes live by setting
// it to `github` once the GitHub App is granted "Dependabot alerts: read". Aggregated per org by
// getOrgSupplyChain and rendered on the Security tab. No DB schema changes — fetched on demand + cached.

import { getInstallationIdForOwner, getOrgRollup } from "@/lib/db";
import { getInstallationToken } from "@/lib/github/app";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";

export type Severity = "critical" | "high" | "medium" | "low";
export interface AdvisoryCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}
export interface RepoAdvisories extends AdvisoryCounts {
  fullName: string;
  name: string;
  total: number;
}
export interface OrgSupplyChain {
  provider: "github" | "mock";
  /** True when the data is deterministic demo data (provider=mock), so the UI can label it honestly. */
  demo: boolean;
  /** True when a github-mode run couldn't authenticate (no installation / token mint failed), so
   *  `scanned: 0` means "couldn't reach GitHub", NOT "genuinely clean". The UI must surface this as a
   *  transient error, never as an all-clear / not-enabled empty state. Never cached. */
  degraded?: boolean;
  scanned: number; // repos we have advisory data for
  totals: AdvisoryCounts & { total: number };
  repos: RepoAdvisories[]; // worst-first (critical, then high, …)
}

const EMPTY: AdvisoryCounts = { critical: 0, high: 0, medium: 0, low: 0 };
const sum = (c: AdvisoryCounts) => c.critical + c.high + c.medium + c.low;

/** Severity of one Dependabot alert object, normalized — tolerant of the API's nested shapes. */
function severityOf(a: unknown): Severity | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const adv = o.security_advisory as Record<string, unknown> | undefined;
  const vuln = o.security_vulnerability as Record<string, unknown> | undefined;
  const raw = adv?.severity ?? vuln?.severity ?? o.severity;
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  return s === "critical" || s === "high" || s === "medium" || s === "low" ? s : null;
}

/** Tally a raw Dependabot alerts API array into severity counts. Pure — unit-tested. */
export function countAdvisories(alerts: unknown[]): AdvisoryCounts {
  const c: AdvisoryCounts = { ...EMPTY };
  for (const a of alerts) {
    const sev = severityOf(a);
    if (sev) c[sev] += 1;
  }
  return c;
}

interface SupplyChainProvider {
  name: "github" | "mock";
  /** Open-advisory counts for one repo, or null when unavailable (no permission/token, API error). */
  fetchAdvisories(owner: string, name: string, token?: string): Promise<AdvisoryCounts | null>;
}

const githubProvider: SupplyChainProvider = {
  name: "github",
  async fetchAdvisories(owner, name, token) {
    if (!token) return null; // needs an installation token with "Dependabot alerts: read"
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${name}/dependabot/alerts?state=open&per_page=100`,
        { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } },
      );
      if (!res.ok) return null; // 403 = permission not granted, 404 = alerts disabled — degrade quietly
      const json = (await res.json()) as unknown;
      return Array.isArray(json) ? countAdvisories(json) : { ...EMPTY };
    } catch {
      return null;
    }
  },
};

/** Deterministic demo data so the feature is visible/testable without a live App install. */
const mockProvider: SupplyChainProvider = {
  name: "mock",
  async fetchAdvisories(owner, name) {
    let h = 0;
    const key = `${owner}/${name}`;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return { critical: h % 3 === 0 ? h % 2 : 0, high: h % 4, medium: h % 5, low: h % 7 };
  },
};

function selectProvider(): SupplyChainProvider | null {
  switch ((process.env.SUPPLY_CHAIN_PROVIDER ?? "off").toLowerCase()) {
    case "github":
      return githubProvider;
    case "mock":
      return mockProvider;
    default:
      return null; // off
  }
}

// Small per-(org × scope) TTL cache so live mode doesn't re-hit the GitHub API on every page render.
// Bounded so it can't grow without limit across tenants/scopes (the Map was previously never evicted).
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 256;
const cache = new Map<string, { at: number; data: OrgSupplyChain }>();

/**
 * Aggregate open Dependabot advisories across an org's scanned repos. Returns null when supply-chain
 * scanning is off (the default). In `github` mode it mints the org's installation token and fetches
 * per repo (bounded concurrency); in `mock` mode it returns deterministic demo data flagged `demo`.
 */
export async function getOrgSupplyChain(orgSlug: string, techGroupId?: string | null): Promise<OrgSupplyChain | null> {
  const provider = selectProvider();
  if (!provider) return null;

  // Key the TTL cache by slug + tech-stack scope so a scoped ("Frontend") result and the fleet-wide one
  // don't share — and overwrite — the same entry.
  const cacheKey = `${orgSlug}::${techGroupId ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  // Scope the advisory fan-out to the same tech-stack subset the rest of the Security page is filtered
  // by — otherwise selecting "Frontend" still tallied Dependabot advisories across the WHOLE fleet
  // (backend repos included) while every other number on the page was frontend-only.
  const rollup = await getOrgRollup(orgSlug, undefined, null, techGroupId ?? null);
  if (!rollup) return null;
  const repos = rollup.repos.filter((r) => r.latest).map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName }));

  let token: string | undefined;
  if (provider.name === "github") {
    const id = await getInstallationIdForOwner(orgSlug).catch(() => null);
    token = id ? await getInstallationToken(id).catch(() => undefined) : undefined;
    // No token → every fetchAdvisories returns null and the run collapses to scanned:0, which is
    // INDISTINGUISHABLE from "genuinely zero advisories". Caching that empty result (as the code used
    // to) serves a recoverable install/token blip as "supply chain clean / not enabled" for the full
    // TTL — the most dangerous false signal in a security view. Return a distinct `degraded` state and
    // do NOT cache it, so the next render re-attempts authentication.
    if (!token) {
      return { provider: "github", demo: false, degraded: true, scanned: 0, totals: { ...EMPTY, total: 0 }, repos: [] };
    }
  }

  const rows = (
    await mapPool(repos, SCAN_CONCURRENCY, async (r) => {
      const counts = await provider.fetchAdvisories(r.owner, r.name, token);
      if (!counts) return null;
      return { fullName: r.fullName, name: r.name, ...counts, total: sum(counts) };
    })
  ).filter((x): x is RepoAdvisories => x !== null);

  const totals = rows.reduce(
    (acc, r) => ({ critical: acc.critical + r.critical, high: acc.high + r.high, medium: acc.medium + r.medium, low: acc.low + r.low }),
    { ...EMPTY },
  );
  rows.sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total);

  const data: OrgSupplyChain = {
    provider: provider.name,
    demo: provider.name === "mock",
    scanned: rows.length,
    totals: { ...totals, total: sum(totals) },
    repos: rows.slice(0, 10),
  };
  // Evict the oldest entry (Map preserves insertion order) once at capacity, so a long-lived process
  // serving many orgs/scopes keeps the cache bounded instead of leaking an entry per tenant forever.
  if (!cache.has(cacheKey) && cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
