// Writing `catalog.json` BACK into the customer's registry after an index pass: the policy half.
//
// The registry's own `.ascent/registry.yaml` decides whether ascent may write at all
// (`policies.catalogWrites`): `bot` commits to the default branch, `pr` opens (or updates) one
// stable-branch pull request. This file decides WHEN, and it is deliberately stingy, because the
// target is a repository ascent does not own:
//
//   no-writer         the source cannot write (a fixture, a self-hosted local checkout)
//   no-spine          the registry has not declared itself; parsed defaults are not consent
//   truncated         GitHub cut the tree short, so the catalog is missing real entries
//   read-failures     a blob failed to read this pass; same hazard, one file at a time
//   prior-unreadable  a committed catalog we could not read is never overwritten blind
//   foreign-producer  another producer signed the committed catalog (`generatedBy`), e.g. the
//                     reference registry's own `scripts/build-catalog.mjs`, whose CI `--check`
//                     would go red on ascent's envelope. Two writers on one file is not ours to start.
//   unchanged         same content as committed, ignoring `generatedAt`/`generatedBy`. This one is
//                     load-bearing: a bot commit fires the registry's push webhook, which runs a
//                     trailing index pass, which must find nothing to write or it would loop forever.
//
// The GitHub half (`./catalog-write-github`) reuses the token the index source already holds, minted
// by the route's gate for the gated org (or, on a push, for the installation bound to the pushing
// owner), and the coordinate from that org's own registry row. Nothing here or there mints a token.

import { REGISTRY_CATALOG_PATH } from "./layout";
import { serializeCatalog, type RegistryCatalog } from "./catalog";
import type { RegistryTreeEntry } from "./read";

/** One stable branch, so a repeat pass updates its own PR instead of opening another. */
export const CATALOG_PR_BRANCH = "ascent/registry-catalog";
/** The `generatedBy` ascent signs its catalogs with (the scaffold seed included). */
export const ASCENT_PRODUCER = "ascent";

export type CatalogWriteSkip =
  | "no-writer"
  | "no-spine"
  | "truncated"
  | "read-failures"
  | "prior-unreadable"
  | "foreign-producer"
  | "unchanged"
  | "pr-current";

export type CatalogWriteOutcome =
  | { kind: "skipped"; reason: CatalogWriteSkip }
  | { kind: "committed"; commitSha: string | null; blobSha: string | null }
  | { kind: "proposed"; url: string; number: number; branch: string; reused: boolean }
  | { kind: "failed"; policy: "bot" | "pr"; message: string };

/** The GitHub writes a policy needs, injectable so the policy is testable without a network. */
export interface CatalogWriter {
  /** Commit `catalog.json` on `branch`. `priorBlobSha` null creates it; otherwise GitHub 409s on a race. */
  commit(i: { branch: string; content: string; priorBlobSha: string | null; message: string }): Promise<{
    commitSha: string | null;
    blobSha: string | null;
  }>;
  /** `catalog.json` as it stands on `branch`, or null when the branch or file is absent. */
  readBranch(branch: string): Promise<string | null>;
  propose(i: { base: string; branch: string; content: string; message: string; title: string; body: string }): Promise<{
    url: string;
    number: number;
    branch: string;
    reused: boolean;
  }>;
}

export type PriorCatalog =
  | { state: "absent" }
  | { state: "unreadable" }
  | { state: "read"; catalog: RegistryCatalog; blobSha: string };

/**
 * Read the committed catalog so `buildCatalog` can carry forward the keys it does not own and the
 * write-back knows what it would replace. Tolerant: an unreadable or malformed catalog means "carry
 * nothing" and "do not overwrite", never a failed pass, and it IS reported, because silently dropping
 * another producer's `bundles` array is the exact outcome this read exists to prevent.
 */
export async function readPriorCatalog(
  entry: RegistryTreeEntry | undefined,
  read: (e: RegistryTreeEntry) => Promise<string | null>,
  warnings: string[],
): Promise<PriorCatalog> {
  if (!entry) return { state: "absent" };
  const text = await read(entry);
  if (text === null) return { state: "unreadable" };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { state: "read", catalog: parsed as RegistryCatalog, blobSha: entry.sha };
    }
    warnings.push(`${REGISTRY_CATALOG_PATH}: not an object; foreign keys not carried forward and not overwritten`);
  } catch {
    warnings.push(`${REGISTRY_CATALOG_PATH}: not valid JSON; foreign keys not carried forward and not overwritten`);
  }
  return { state: "unreadable" };
}

/** Key-order-insensitive form of a JSON value, so two producers' spellings of one catalog compare equal. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return v;
}

const body = (c: Record<string, unknown>) => {
  const rest = { ...c };
  delete rest.generatedAt;
  delete rest.generatedBy;
  return JSON.stringify(canonical(rest));
};

/** Same catalog content? `generatedAt` and `generatedBy` are provenance, not content. */
export const sameCatalog = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => body(a) === body(b);

export interface CatalogWriteInput {
  policy: "bot" | "pr";
  /** `.ascent/registry.yaml` was present and read this pass. */
  spinePresent: boolean;
  truncated: boolean;
  /** Blob reads that THREW this pass (not size-cap skips, which are permanent and already warned). */
  readFailures: number;
  prior: PriorCatalog;
  next: RegistryCatalog;
  /** The registry's default branch: where `bot` commits and what a `pr` targets. */
  branch: string;
  headSha: string;
  writer?: CatalogWriter;
}

/** Why this pass must not write, or null when it may. Pure: the whole policy in one place. */
export function catalogWriteSkip(i: CatalogWriteInput): CatalogWriteSkip | null {
  if (!i.writer) return "no-writer";
  if (!i.spinePresent) return "no-spine";
  if (i.truncated) return "truncated";
  if (i.readFailures > 0) return "read-failures";
  if (i.prior.state === "unreadable") return "prior-unreadable";
  if (i.prior.state === "read") {
    const by = i.prior.catalog.generatedBy;
    if (typeof by === "string" && by !== "" && by !== ASCENT_PRODUCER) return "foreign-producer";
    if (sameCatalog(i.prior.catalog, i.next)) return "unchanged";
  }
  return null;
}

const PR_BODY =
  "Generated by Ascent from this registry's own lanes (skills, practices, memory, usage). " +
  "Keys Ascent does not produce are carried forward untouched. " +
  "This registry's `.ascent/registry.yaml` sets `catalogWrites: pr`, so the catalog lands only when this is merged.";

/**
 * Apply the policy. Never throws: a GitHub refusal (a protected default branch, a race on the blob
 * sha, a missing write scope) comes back as `failed` and the caller reports it as a warning on a pass
 * that otherwise succeeded.
 */
export async function writeCatalogBack(i: CatalogWriteInput): Promise<CatalogWriteOutcome> {
  const skip = catalogWriteSkip(i);
  if (skip) return { kind: "skipped", reason: skip };
  const writer = i.writer!;
  const content = serializeCatalog(i.next);
  const message = `chore(registry): regenerate catalog.json at ${i.headSha.slice(0, 7)}`;
  try {
    if (i.policy === "bot") {
      const priorBlobSha = i.prior.state === "read" ? i.prior.blobSha : null;
      const out = await writer.commit({ branch: i.branch, content, priorBlobSha, message });
      return { kind: "committed", ...out };
    }
    const onBranch = await writer.readBranch(CATALOG_PR_BRANCH);
    if (onBranch !== null) {
      try {
        const parsed: unknown = JSON.parse(onBranch);
        if (parsed && typeof parsed === "object" && sameCatalog(parsed as Record<string, unknown>, i.next)) {
          return { kind: "skipped", reason: "pr-current" };
        }
      } catch {
        // A mangled file on ascent's own branch is simply replaced.
      }
    }
    const pr = await writer.propose({
      base: i.branch,
      branch: CATALOG_PR_BRANCH,
      content,
      message,
      title: "catalog.json: regenerate from the registry's lanes",
      body: PR_BODY,
    });
    return { kind: "proposed", ...pr };
  } catch (err) {
    return { kind: "failed", policy: i.policy, message: err instanceof Error ? err.message : String(err) };
  }
}
