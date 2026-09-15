// The ledger's TAMPER-EVIDENCE, and the reason it is a DAILY seal rather than a per-row hash chain
// (moonshot #1).
//
// Both source decks asked for a chain over the webhook-fed rows. `src/lib/db/audit-integrity.ts`
// already refused a chain for a stated reason — webhook deliveries are concurrent, so every append
// would be a read-modify-write on the previous row's digest and two writers would fork the chain
// permanently. Reintroducing it here would reintroduce exactly that fork.
//
// So: each row carries its own HMAC (`signAudit`, the existing per-row mechanism), and each CLOSED
// UTC day gets one seal — a sha256 root over that day's sorted row digests, plus the previous sealed
// day's root. What this buys, precisely:
//
//   • deleting a row changes its day's root                    → detectable
//   • deleting a whole day breaks the next day's `prevRoot`    → detectable
//   • editing a row changes its digest and its day's root      → detectable
//   • writers never contend: a day is sealed once, after it closed
//
// What it does NOT buy, stated so nobody over-claims it: the seals are ours, so an operator holding
// the database could re-seal a rewritten day. Detecting that needs a published key and a third-party
// timestamp — deck item #6, deferred. This is the secret-free half, and the /api/audit/verify route
// says so in the same breath as the verdict.
//
// EVERYTHING HERE IS PURE AND SECRET-FREE. `rowDigest` and `dayRoot` use only sha256 over canonical
// JSON, so an examiner recomputes the root from the exported CSV with `sha256sum` and no key from
// us. A verification an examiner cannot perform independently is a claim, not evidence.

import { sha256Hex } from "@/lib/db/audit-integrity";

/** The canonical, order-independent field set a row digest is computed over. Deliberately a SUBSET
 *  of the row: `id` (a uuid we minted) and `observedAt`/`createdAt` (our clocks) are excluded, so a
 *  legitimate re-import that re-mints ids still recomputes the same root. What IS included is every
 *  field an examiner would care about having been altered. */
export interface SealableRow {
  orgId: string;
  repoFullName: string;
  controlId: string;
  state: string;
  value: string | null;
  prevState: string | null;
  prevValue: string | null;
  source: string;
  actorLogin: string | null;
  transition: boolean;
  /** ISO instant. */
  occurredAt: string;
  evidenceJson: string;
}

/** The exact field order the digest serializes. PUBLISHED by /api/audit/verify — changing it
 *  invalidates every existing seal, so it is a breaking change to the evidence, not a refactor. */
export const DIGEST_FIELD_ORDER: readonly (keyof SealableRow)[] = [
  "orgId",
  "repoFullName",
  "controlId",
  "state",
  "value",
  "prevState",
  "prevValue",
  "source",
  "actorLogin",
  "transition",
  "occurredAt",
  "evidenceJson",
];

/** Canonical JSON: keys emitted in DIGEST_FIELD_ORDER, nulls as `null`, no whitespace. Key-order
 *  independent by construction — the caller's object key order cannot change the digest. */
function canonical(r: SealableRow): string {
  const parts = DIGEST_FIELD_ORDER.map((k) => `${JSON.stringify(k)}:${JSON.stringify(r[k] ?? null)}`);
  return `{${parts.join(",")}}`;
}

/** sha256 of one row's canonical form. Secret-free and deterministic. */
export function rowDigest(r: SealableRow): string {
  return sha256Hex(canonical(r));
}

/**
 * The day's root: sha256 over the day's digests SORTED lexicographically, joined by newline, with
 * the previous day's root folded in as the first line.
 *
 * Sorting is what makes the root independent of insert order — two replicas that received the same
 * deliveries in different orders must seal to the same root, or the seal reports a tamper every time
 * a queue reorders. Duplicates are NOT deduped: two identical rows are two rows, and collapsing them
 * would let a duplicate injection hide.
 */
export function dayRoot(digests: readonly string[], prevRoot: string | null): string {
  const body = [...digests].sort().join("\n");
  return sha256Hex(`${prevRoot ?? ""}\n${body}`);
}

/** The recomputation recipe, shipped verbatim in the verify response so the check is reproducible
 *  from an export without reading this file. */
export const SEAL_RECIPE = {
  rowDigest:
    "sha256 (hex, lower-case) of the row rendered as compact JSON with exactly these keys in this " +
    `order: ${DIGEST_FIELD_ORDER.join(", ")}. Absent/null values are the JSON literal null; ` +
    "booleans are true/false; no whitespace between tokens.",
  dayRoot:
    "sha256 (hex) of: the previous sealed day's root (empty string for the first sealed day), a " +
    "newline, then that day's row digests sorted lexicographically ascending and joined by newlines.",
  day: "A day is the UTC calendar day of the row's occurredAt.",
  limits:
    "The seals are produced by Ascent and stored in the same database as the rows, so they detect " +
    "row and day-level alteration or deletion by anything WITHOUT database write access. They do " +
    "not, and are not claimed to, detect an operator with database access re-sealing a rewritten " +
    "day. Independent attestation requires a published key and an external timestamp, which Ascent " +
    "does not yet issue.",
} as const;

/** The UTC calendar day (YYYY-MM-DD) an instant belongs to. Null for an unparseable stamp — a row we
 *  cannot place in a day is reported as unsealable rather than filed under today. */
export function utcDay(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** True when `day` is strictly before the UTC day containing `now` — i.e. the day is CLOSED and can
 *  never receive another row. Only closed days are sealable; sealing today would freeze a root that
 *  the next append immediately invalidates. */
export function isClosedDay(day: string, now: number): boolean {
  const today = new Date(now).toISOString().slice(0, 10);
  return day < today;
}
