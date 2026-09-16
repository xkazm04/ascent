// The local twin of `conformance-read.ts`: a fleet repo's standards + foundation files, read from its
// PAIRED working copy (`Repository.localPath`) instead of through a GitHub App token.
//
// WORKING TREE, not HEAD — deliberately unlike the registry's own local source. What the sweep reads
// here is the repo's self-description, and part of it is local by design: `.ai/consults.jsonl` is
// gitignored in consuming repos ("the log itself stays local"), so a HEAD read would report every
// paired repo's consult lane as never written. The paired checkout IS the repo on a self-hosted box;
// the scan of the same repo reads the same disk.
//
// Same degrade contract as the GitHub reader: an ABSENT file is null, an oversized one is null, and
// only a folder that cannot be read at all throws, so the sweep records a warning and changes nothing.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { FOUNDATION_SPINES } from "@/lib/local/lane-kind";
import { parseContextMapRevision } from "./conformance-map";
import { MAX_STANDARDS_BYTES, REPO_CONTEXT_MAP_PATH, REPO_DIRECTIONS_LEDGER_PATH, type RepoStandardsFiles } from "./conformance-read";
import { REGISTRY_MAP_PATH, REPO_CONSULTS_PATH } from "./layout";

/** A file's text, or null when absent or over `cap`. */
async function readCapped(dir: string, rel: string, cap = MAX_STANDARDS_BYTES): Promise<string | null> {
  const abs = path.join(dir, ...rel.split("/"));
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile() || st.size > cap) return null;
  return readFile(abs, "utf8").catch(() => null);
}

/** Git's blob id for `text` — the same idempotency key the GitHub reader gets from the Contents API,
 *  so a repo swept locally and later through GitHub does not re-ingest an unchanged map. */
export function gitBlobSha(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.byteLength}\0`).update(body).digest("hex");
}

export async function readLocalStandardsFiles(dir: string): Promise<RepoStandardsFiles> {
  const root = await stat(dir).catch(() => null);
  if (!root?.isDirectory()) throw new Error(`paired folder ${dir} is not readable`);

  const hasContextMap = Boolean((await stat(path.join(dir, REPO_CONTEXT_MAP_PATH)).catch(() => null))?.isFile());
  let manifest: string | null = null;
  for (const spine of FOUNDATION_SPINES) {
    manifest = await readCapped(dir, spine);
    if (manifest !== null) break;
  }
  const ledger = await readCapped(dir, REPO_DIRECTIONS_LEDGER_PATH);
  const map = await readCapped(dir, REGISTRY_MAP_PATH);
  if (map === null) {
    return { map: null, consults: null, mapSha: null, reason: `no ${REGISTRY_MAP_PATH}`, manifest, ledger, hasContextMap, warnings: [] };
  }
  const consults = await readCapped(dir, REPO_CONSULTS_PATH);
  return { map, consults, mapSha: gitBlobSha(map), reason: null, manifest, ledger, hasContextMap, warnings: [] };
}

/** `revision` of the checkout's `context-map.json`, or null — never throws, like the GitHub twin. */
export async function readLocalContextMapRevision(dir: string): Promise<string | null> {
  const text = await readCapped(dir, REPO_CONTEXT_MAP_PATH, MAX_STANDARDS_BYTES).catch(() => null);
  return text === null ? null : parseContextMapRevision(text);
}
