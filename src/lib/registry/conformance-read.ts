// The App-token side channel that fetches a managed repo's `.ai/registry-map.json` and
// `.ai/consults.jsonl` (#18).
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
import { REGISTRY_MAP_PATH, REGISTRY_SPINE_PATH, REPO_CONSULTS_PATH } from "./layout";

/** Hard ceiling per file. The map is the big one (~113KB here); half a megabyte is generous headroom
 *  and still bounds the memory a fleet-wide sweep can hold at once. */
export const MAX_STANDARDS_BYTES = 512 * 1024;

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
 * Both standards files for one repo. `ref` is optional — omitted, GitHub serves the default branch,
 * which is what a fleet sweep wants and is why this does not need a `defaultBranch` column.
 *
 * Never throws for an ABSENT file. A transport failure still throws, so the sweep can report that
 * repo as a warning rather than silently recording it as having no map — those are different facts
 * and conflating them would turn an outage into a fleet-wide "nobody has standards".
 */
export async function readRepoStandardsFiles(
  token: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<RepoStandardsFiles> {
  const map = await readFile(token, owner, repo, REGISTRY_MAP_PATH, ref);
  if (!map) return { map: null, consults: null, mapSha: null, reason: "no .ai/registry-map.json" };
  // The consults lane is optional and its absence is a legitimate state, so its read failing must
  // not cost us the map we already hold.
  const consults = await readFile(token, owner, repo, REPO_CONSULTS_PATH, ref).catch(() => null);
  return { map: map.text, consults: consults?.text ?? null, mapSha: map.sha, reason: null };
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
