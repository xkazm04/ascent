// The App-token side channel that fetches a managed repo's `.ai/registry-map.json`,
// `.ai/consults.jsonl` and — since the knowledge-base rebuild — its FOUNDATION files:
// `.ai/manifest.yaml` (or `.yml`), `.ai/directions/ledger.jsonl` and the PRESENCE of
// `context-map.json` at the root (#18).
//
// WHY THIS IS NOT A SCAN FETCH, which is the whole reason the file exists. `pickFilesToFetch` spends
// a 50-file budget and truncates every file at 14,000 bytes, because what it fetches goes into an
// assessment prompt. This repo's own map is 113KB: through that path it would arrive truncated into
// unparseable JSON *and* cost a prompt slot that a source file should have had. So the ingest reads
// it out-of-band, under its own cap, and the scan pipeline is untouched — which is also what keeps
// this item disjoint from the lanes that own `src/lib/github/source.ts`.
//
// Everything goes through `githubAppFetch`, the same audited client `registry/read.ts` uses: one
// timeout budget, one header set, `AppApiError` on non-2xx.

import { githubAppFetch, AppApiError } from "@/lib/github/app";
import { encodePathSegments } from "@/lib/github/host";
import { FOUNDATION_SPINES } from "@/lib/local/lane-kind";
import { REGISTRY_MAP_PATH, REGISTRY_SPINE_PATH, REPO_CONSULTS_PATH } from "./layout";

/** Hard ceiling per file. The map is the big one (~113KB here); half a megabyte is generous headroom
 *  and still bounds the memory a fleet-wide sweep can hold at once. */
export const MAX_STANDARDS_BYTES = 512 * 1024;

/** In a managed repo: the owner's decisions on proposed directions, one JSON object per line. */
export const REPO_DIRECTIONS_LEDGER_PATH = ".ai/directions/ledger.jsonl";

/** In a managed repo: the context map `/populate` writes at the root. Read for PRESENCE only. */
export const REPO_CONTEXT_MAP_PATH = "context-map.json";

export interface RepoStandardsFiles {
  /** `.ai/registry-map.json` body, or null when the repo has none / it was unreadable. */
  map: string | null;
  /** `.ai/consults.jsonl` body, or null when absent. NULL is load-bearing downstream: it becomes a
   *  null `consults30d`, which is "the lane was never written", not "nobody consulted". */
  consults: string | null;
  /** Blob sha of the map — the idempotency key for a re-sweep. */
  mapSha: string | null;
  /** Why the map is null, when it is. Null when the map was read. */
  reason: string | null;
  /** `.ai/manifest.yaml` (or `.yml`, the alternate spelling `FOUNDATION_SPINES` names) body, or null. */
  manifest: string | null;
  /** `.ai/directions/ledger.jsonl` body, or null when the repo has never decided a direction. */
  ledger: string | null;
  /** Whether `context-map.json` exists at the repo root. The body is NEVER read — it is large and
   *  the sweep needs only the fact of it (the `populate` stage). */
  hasContextMap: boolean;
  /** Reads that could not be completed short of a transport failure, for the repo's warnings. */
  warnings: string[];
}

interface ContentsFile {
  content?: string;
  encoding?: string;
  size?: number;
  sha?: string;
  type?: string;
}

/**
 * Read one file through the Contents API. Returns null for "not there / not readable" and lets a
 * real transport failure throw, so a 404 (an expected, common answer) is never confused with an
 * outage.
 */
async function readFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<{ text: string; sha: string | null } | null> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  let file: ContentsFile;
  try {
    file = await githubAppFetch<ContentsFile>(`/repos/${owner}/${repo}/contents/${encodePathSegments(path)}${q}`, token);
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null;
    throw err;
  }
  if (file.type !== "file" || !file.content) return null;
  if ((file.size ?? 0) > MAX_STANDARDS_BYTES) return null;
  if (file.encoding && file.encoding !== "base64") return null;
  const buf = Buffer.from(file.content, "base64");
  // The API's own `size` can disagree with the decoded length; re-check so the cap is on what we
  // actually hold, not on what we were told we would hold.
  if (buf.byteLength > MAX_STANDARDS_BYTES) return null;
  return { text: buf.toString("utf8"), sha: file.sha ?? null };
}

/**
 * The repo's ROOT listing — one request that answers "is `context-map.json` there?" and "is there
 * an `.ai/` directory at all?" without fetching either body. The Git Trees API (non-recursive)
 * is the HEAD-style probe here: GitHub's Contents endpoint always returns the base64 body, and a
 * context map is the one file the sweep must never pay to read. `null` = the probe itself failed
 * (a 404 on an empty repo, a transport error), which the caller treats as UNKNOWN, not absent.
 */
async function readRootListing(token: string, owner: string, repo: string, ref?: string): Promise<Set<string> | null> {
  try {
    const tree = await githubAppFetch<{ tree?: { path?: string; type?: string }[] }>(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref ?? "HEAD")}`,
      token,
    );
    return new Set((tree.tree ?? []).map((e) => e.path).filter((p): p is string => typeof p === "string"));
  } catch (err) {
    if (err instanceof AppApiError && (err.status === 404 || err.status === 409)) return null;
    throw err;
  }
}

/**
 * Every standards + foundation file for one repo. `ref` is optional — omitted, GitHub serves the
 * default branch, which is what a fleet sweep wants and is why this does not need a `defaultBranch`
 * column.
 *
 * Never throws for an ABSENT file. A transport failure on the MAP still throws, so the sweep can
 * report that repo as a warning rather than silently recording it as having no map — those are
 * different facts and conflating them would turn an outage into a fleet-wide "nobody has standards".
 * The optional lanes (consults, manifest, ledger) each degrade on their own: failing to read one
 * must not cost the map already held.
 */
export async function readRepoStandardsFiles(
  token: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<RepoStandardsFiles> {
  const warnings: string[] = [];
  const root = await readRootListing(token, owner, repo, ref);
  if (root === null) warnings.push(`${REPO_CONTEXT_MAP_PATH}: presence could not be probed — stage may read as populate`);
  const hasContextMap = root?.has(REPO_CONTEXT_MAP_PATH) ?? false;
  // No `.ai/` directory at all: nothing below can exist, so spend no requests looking.
  const hasAi = root === null ? true : root.has(".ai");

  const optional = async (path: string): Promise<string | null> => {
    if (!hasAi) return null;
    try {
      return (await readFile(token, owner, repo, path, ref))?.text ?? null;
    } catch (err) {
      warnings.push(`${path}: not read (${err instanceof Error ? err.message : String(err)})`);
      return null;
    }
  };

  // The manifest under either spelling; the first that exists wins.
  let manifest: string | null = null;
  for (const spine of FOUNDATION_SPINES) {
    manifest = await optional(spine);
    if (manifest !== null) break;
  }
  const ledger = await optional(REPO_DIRECTIONS_LEDGER_PATH);

  const map = hasAi ? await readFile(token, owner, repo, REGISTRY_MAP_PATH, ref) : null;
  if (!map) {
    return { map: null, consults: null, mapSha: null, reason: `no ${REGISTRY_MAP_PATH}`, manifest, ledger, hasContextMap, warnings };
  }
  const consults = await optional(REPO_CONSULTS_PATH);
  return { map: map.text, consults, mapSha: map.sha, reason: null, manifest, ledger, hasContextMap, warnings };
}

/**
 * The registry's own spine (`.ascent/registry.yaml`), read LIVE.
 *
 * The signals writer gates on it, and a gate that read a cached copy would publish against a
 * declaration the customer may have revoked since the last index pass. Null when the file is absent,
 * which the caller must treat as "not declared" — the fail-closed reading.
 */
export async function readRegistrySpine(token: string, owner: string, repo: string, ref?: string): Promise<string | null> {
  const file = await readFile(token, owner, repo, REGISTRY_SPINE_PATH, ref);
  return file?.text ?? null;
}
