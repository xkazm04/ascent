// Current supply-chain EXPOSURE — open known vulnerabilities in a repo's dependencies, from OSV.dev
// (public, no auth) by parsing the committed npm lockfile. This is the "open vulns are the real
// negative" signal (per OpenSSF Scorecard's Vulnerabilities check), kept SEPARATE from posture. npm is
// the dominant ecosystem here; other ecosystems (or no lockfile) return `known:false` = UNKNOWN, which
// the score treats as neutral, never as "clean". Bounded (≤500 deps queried, ≤40 vuln details fetched)
// so it can't blow the scan's time budget.

import type { SecurityExposure } from "@/lib/types";
import { fetchWithTimeout, ghHeaders, githubRawBase } from "@/lib/github/host";
import { mapPool } from "@/lib/pool";

const RAW = githubRawBase();
const OSV_BATCH = "https://api.osv.dev/v1/querybatch";
const OSV_VULN = "https://api.osv.dev/v1/vulns";
const TIMEOUT_MS = 12_000;
const MAX_DEPS = 500; // cap OSV queries per repo
const MAX_VULN_DETAILS = 40; // cap severity look-ups; the rest count as "high" (conservative)
const MAX_LOCKFILE_BYTES = 6_000_000;

const UNKNOWN: SecurityExposure = { known: false, source: "none", critical: 0, high: 0, medium: 0, low: 0, scanned: 0 };

/** Fetch + parse the npm lockfile and grade the repo's open-vuln exposure via OSV. Never throws. */
export async function fetchSecurityExposure(
  owner: string,
  repo: string,
  ref: string,
  token?: string,
  signal?: AbortSignal,
): Promise<SecurityExposure> {
  try {
    const deps = await fetchNpmDeps(owner, repo, ref, token, signal);
    if (!deps.length) return UNKNOWN;
    return await osvExposure(deps.slice(0, MAX_DEPS), signal);
  } catch {
    return UNKNOWN;
  }
}

/** Parse (name, version) pairs from package-lock.json (lockfileVersion 2/3 `packages`, else v1 `dependencies`). */
async function fetchNpmDeps(owner: string, repo: string, ref: string, token?: string, signal?: AbortSignal): Promise<{ name: string; version: string }[]> {
  const url = `${RAW}/${owner}/${repo}/${encodeURIComponent(ref)}/package-lock.json`;
  const res = await fetchWithTimeout(url, { headers: token ? ghHeaders(token, { accept: "*/*" }) : { "User-Agent": "ascent" } }, TIMEOUT_MS, signal);
  if (!res.ok) return [];
  const text = await res.text();
  if (text.length > MAX_LOCKFILE_BYTES) return [];
  const json = JSON.parse(text) as { packages?: Record<string, { name?: string; version?: string }>; dependencies?: Record<string, { version?: string }> };
  const seen = new Set<string>();
  const out: { name: string; version: string }[] = [];
  const push = (name: string, version?: string) => {
    if (!name || !version || !/^\d/.test(version)) return; // skip ranges / file: / git specs
    const key = `${name}@${version}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, version });
  };
  if (json.packages) {
    for (const [path, meta] of Object.entries(json.packages)) {
      if (!path) continue; // "" is the root project
      const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      push(name, meta.version);
    }
  } else if (json.dependencies) {
    for (const [name, meta] of Object.entries(json.dependencies)) push(name, meta.version);
  }
  return out;
}

/** OSV batch query → count vulnerable packages, then bucket by severity (bounded detail look-ups). */
async function osvExposure(deps: { name: string; version: string }[], signal?: AbortSignal): Promise<SecurityExposure> {
  const body = JSON.stringify({ queries: deps.map((d) => ({ package: { name: d.name, ecosystem: "npm" }, version: d.version })) });
  const res = await fetchWithTimeout(OSV_BATCH, { method: "POST", headers: { "content-type": "application/json" }, body }, TIMEOUT_MS, signal);
  if (!res.ok) return UNKNOWN;
  const json = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
  const vulnIds = new Set<string>();
  for (const r of json.results ?? []) for (const v of r.vulns ?? []) vulnIds.add(v.id);
  if (vulnIds.size === 0) return { known: true, source: "osv", critical: 0, high: 0, medium: 0, low: 0, scanned: deps.length };

  const ids = [...vulnIds];
  const sampled = ids.slice(0, MAX_VULN_DETAILS);
  const sev = { critical: 0, high: 0, medium: 0, low: 0 };
  const severities = await mapPool(sampled, 6, (id) => fetchOsvSeverity(id, signal));
  for (const s of severities) sev[s] += 1;
  // Vulns beyond the sampled detail budget: count as "high" (conservative, not silently dropped).
  sev.high += Math.max(0, ids.length - sampled.length);
  return { known: true, source: "osv", ...sev, scanned: deps.length };
}

type Sev = "critical" | "high" | "medium" | "low";

/** One vuln's severity from OSV — GHSA `database_specific.severity` first, then CVSS score. Defaults high. */
async function fetchOsvSeverity(id: string, signal?: AbortSignal): Promise<Sev> {
  try {
    const res = await fetchWithTimeout(`${OSV_VULN}/${encodeURIComponent(id)}`, {}, TIMEOUT_MS, signal);
    if (!res.ok) return "high";
    const v = (await res.json()) as { database_specific?: { severity?: string }; severity?: { type: string; score: string }[] };
    const label = v.database_specific?.severity?.toUpperCase();
    if (label === "CRITICAL") return "critical";
    if (label === "HIGH") return "high";
    if (label === "MODERATE" || label === "MEDIUM") return "medium";
    if (label === "LOW") return "low";
    const cvss = v.severity?.find((s) => s.type?.startsWith("CVSS"));
    if (cvss) {
      const score = cvssBaseScore(cvss.score);
      if (score >= 9) return "critical";
      if (score >= 7) return "high";
      if (score >= 4) return "medium";
      if (score > 0) return "low";
    }
    return "high";
  } catch {
    return "high";
  }
}

/** Pull the numeric base score from a CVSS vector string; 0 when unparseable (caller falls back). */
function cvssBaseScore(vector: string): number {
  // OSV usually gives the vector, not the score — a rough proxy: count high-impact metrics.
  // (A full CVSS calculator is out of scope; the GHSA label above is the primary path.)
  const n = Number(vector);
  if (Number.isFinite(n)) return n;
  let score = 0;
  if (/AV:N/.test(vector)) score += 3;
  if (/[CIA]:H/.test(vector)) score += 4;
  if (/PR:N/.test(vector)) score += 2;
  return Math.min(10, score);
}
