// SELF-HOSTED registry pairing: the org's registry read from a working copy on the server's disk, with
// no GitHub App in the loop. Admin -> Pairing's first step writes it (`pairLocalRegistry`); every
// registry read route asks `localRegistryDir` first and only falls back to an installation token when
// the registry is not paired (see `resolveRegistrySource` in ./api).
//
// Why local FIRST rather than as a fallback: on a self-hosted box the registry checkout is the thing
// the operator edits, commits and links skills from (`link-registry.mjs`). Reading it through GitHub
// would mean the app lags the operator by a push, and needs an App the deployment usually lacks.
//
// The stored path is verified at write (git working copy, at least one registry lane at HEAD) and
// re-checked at every use by git itself: a folder that moved fails the pass with a reason.

import path from "node:path";
import { selfHosted } from "@/lib/env";
import { runGit } from "@/lib/local/git";
import { verifyLocalPath, type PairingCheck } from "@/lib/local/pairing";
import { getOrgRegistry, upsertOrgRegistry, type OrgRegistryRow } from "@/lib/db/org-registry";
import { indexRegistry, type IndexRegistryResult } from "./index-registry";
import { REGISTRY_DIRS, REGISTRY_KNOWLEDGE_DIR } from "./layout";
import { localSource, resolveLocalRegistry } from "./local-source";

/** Top-level directories at least one of which makes a checkout a registry rather than any repo. */
const REGISTRY_LANES = [REGISTRY_DIRS.skills, REGISTRY_DIRS.practices, REGISTRY_DIRS.memory, REGISTRY_KNOWLEDGE_DIR];

export interface LocalRegistryCheck extends PairingCheck {
  /** The registry lanes found at HEAD — empty means "a git repo, but not a registry". */
  lanes: string[];
  /** The name the row is stored under: the origin (case from the app manifest when it agrees), else `local/<folder>`. */
  fullName: string | null;
}

/** The registry dir to read for this row, or null when it is read through GitHub. */
export function localRegistryDir(row: Pick<OrgRegistryRow, "localPath"> | null): string | null {
  return selfHosted() && row?.localPath ? row.localPath : null;
}

/** Verify `dir` as a registry checkout. Never throws. */
export async function verifyLocalRegistry(dir: string): Promise<LocalRegistryCheck> {
  const check = await verifyLocalPath(dir, "");
  if (!check.ok) return { ...check, lanes: [], fullName: null };
  const top = await runGit(dir.trim(), ["ls-tree", "--name-only", "HEAD"]);
  const names = new Set(top.ok ? top.stdout.split(/\r?\n/) : []);
  const lanes = REGISTRY_LANES.filter((l) => names.has(l));
  const manifestRemote = (await resolveLocalRegistry().catch(() => null))?.fullName ?? null;
  const fullName = check.origin
    ? manifestRemote && manifestRemote.toLowerCase() === check.origin ? manifestRemote : check.origin
    : `local/${path.basename(dir.trim())}`;
  if (!lanes.length) {
    return { ...check, ok: false, error: `No registry lanes at HEAD (expected one of ${REGISTRY_LANES.join(", ")}).`, lanes, fullName };
  }
  // A pairing is a claim about the ORG's registry, not about which repo the app's manifest names, so
  // the origin check is informational here: "match" means it agrees with `registry.remote`.
  const originMatch: PairingCheck["originMatch"] = !check.origin || !manifestRemote ? "unknown" : fullName === manifestRemote ? "match" : "mismatch";
  return { ...check, originMatch, lanes, fullName };
}

export type PairRegistryResult =
  | { ok: true; check: LocalRegistryCheck; row: OrgRegistryRow; index: IndexRegistryResult }
  | { ok: false; check: LocalRegistryCheck; error: string };

/** Pair `dir` as the org's canonical registry and index it. The row keeps any GitHub mapping it had. */
export async function pairLocalRegistry(slug: string, dir: string, createdBy: string | null): Promise<PairRegistryResult> {
  const check = await verifyLocalRegistry(dir);
  if (!check.ok || !check.fullName) return { ok: false, check, error: check.error ?? "Not a registry checkout." };
  const row = await upsertOrgRegistry(slug, {
    fullName: check.fullName,
    defaultBranch: check.branch ?? "main",
    canonical: true,
    mode: "git_native",
    status: "scaffolding",
    localPath: dir.trim(),
    createdBy,
  });
  if (!row) return { ok: false, check, error: "The registry could not be saved." };
  const index = await indexRegistry(row, localSource(row.localPath!));
  inFlight.delete(row.id);
  return { ok: true, check, row, index };
}

/** Clear the pairing. The row and its last index stay readable; reads fall back to GitHub. */
export async function unpairLocalRegistry(slug: string): Promise<boolean> {
  const row = await getOrgRegistry(slug);
  if (!row) return false;
  return (await upsertOrgRegistry(slug, { fullName: row.fullName, canonical: row.canonical, localPath: null })) !== null;
}

// ── keeping the index current without a webhook ─────────────────────────────────────────────────
// The hosted path re-indexes on the registry's push webhook. A local checkout has no webhook, so a
// render that sees the checkout's branch head differ from `lastIndexSha` starts a pass in the
// background. One pass per registry at a time, and at most one HEAD probe per registry per window.

const PROBE_WINDOW_MS = 30_000;
const inFlight = new Map<string, Promise<unknown>>();
const lastProbe = new Map<string, number>();

/** Fire-and-forget: index a paired registry whose checkout moved past the last index. Never throws. */
export function refreshLocalRegistryIfStale(row: OrgRegistryRow | null, now = Date.now()): void {
  const dir = localRegistryDir(row);
  if (!row || !dir || inFlight.has(row.id)) return;
  if (now - (lastProbe.get(row.id) ?? 0) < PROBE_WINDOW_MS) return;
  lastProbe.set(row.id, now);
  const run = (async () => {
    const head = await runGit(dir, ["rev-parse", "HEAD"]);
    if (!head.ok || head.stdout.trim() === row.lastIndexSha) return;
    await indexRegistry(row, localSource(dir));
  })()
    .catch(() => {})
    .finally(() => inFlight.delete(row.id));
  inFlight.set(row.id, run);
}
