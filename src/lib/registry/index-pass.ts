// THE ONE DOOR INTO THE INDEXER. Every trigger that re-reads a registry — the tab's Re-index button,
// Admin -> Pairing, the self-hosted render refresh, the registry's own push webhook — goes through
// `runIndexPass`, so at most one pass per registry runs in this process at a time. Two passes over the
// same registry race purge-then-insert writers (`archiveVanishedRegistryRows`, `purgeUsageSamples`,
// `replaceRegistrySubjects`), which is the failure this file exists to make unavailable.
//
// The second caller's answer is a POLICY chosen by the trigger, not by this file:
//   join  — a click or a pairing wants THE result: it gets the pass already running.
//   trail — a push says "HEAD moved": the running pass may have read an older tree, so at most ONE
//           trailing pass is queued behind it, and every further push while it waits shares that
//           slot (with the newest source, whose token is freshest). Never a queue that grows.
//
// Release is TOKEN-SCOPED: a flight is ended only by whoever holds its token, so a confused caller can
// no longer clear another pass's entry (pairing used to `delete` a guard it had never set).
//
// Process-local by design, like the webhook route's `serializePerRepo`: a second instance can still
// run its own pass. That residual overlap is the same exposure every caller had before this door, now
// narrowed to one pass per instance rather than one per click.

import type { OrgRegistryRow } from "@/lib/db/org-registry";
import { indexRegistry, type IndexRegistryResult, type RegistrySource } from "./index-registry";

export type IndexPassPolicy = "join" | "trail";

interface Trailing {
  row: OrgRegistryRow;
  source: RegistrySource;
  promise: Promise<IndexRegistryResult>;
  resolve: (result: IndexRegistryResult) => void;
}

interface Flight {
  token: symbol;
  promise: Promise<IndexRegistryResult>;
  trailing: Trailing | null;
}

const flights = new Map<string, Flight>();

/** Is a pass for this registry running in this process right now? */
export function indexPassInFlight(registryId: string): boolean {
  return flights.has(registryId);
}

/** The running flight's release token, or null. Exposed for the release discipline's tests. */
export function indexPassToken(registryId: string): symbol | null {
  return flights.get(registryId)?.token ?? null;
}

/**
 * End the flight `token` names. A token that no longer names the current flight (a late or confused
 * caller) is a no-op and returns false. Ending a flight launches its trailing pass, if one waits, in
 * the SAME synchronous step — so no caller can slip a third pass into the gap between the two.
 */
export function endIndexPass(registryId: string, token: symbol): boolean {
  const flight = flights.get(registryId);
  if (!flight || flight.token !== token) return false;
  flights.delete(registryId);
  const next = flight.trailing;
  if (next) void begin(next.row, next.source).then(next.resolve);
  return true;
}

function begin(row: OrgRegistryRow, source: RegistrySource): Promise<IndexRegistryResult> {
  const token = Symbol(row.id);
  let settle!: (result: IndexRegistryResult) => void;
  const promise = new Promise<IndexRegistryResult>((resolve) => (settle = resolve));
  // Registered BEFORE the indexer is invoked, so even a caller arriving in the same tick finds it.
  flights.set(row.id, { token, promise, trailing: null });
  void (async () => {
    let result: IndexRegistryResult;
    try {
      result = await indexRegistry(row, source);
    } catch (err) {
      // `indexRegistry` never throws by contract; this only keeps a broken contract from wedging the
      // door shut for the life of the process.
      result = { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
    // Release first, then settle: the trailing pass is already registered when joiners wake up.
    endIndexPass(row.id, token);
    settle(result);
  })();
  return promise;
}

/**
 * Run an index pass over `row` through the single-flight door. Nothing running: starts one, whatever
 * the policy. Never rejects — a failed pass resolves to `{ kind: "error" }` exactly as
 * `indexRegistry` does, and has already recorded itself on the row.
 */
export function runIndexPass(row: OrgRegistryRow, source: RegistrySource, policy: IndexPassPolicy): Promise<IndexRegistryResult> {
  const current = flights.get(row.id);
  if (!current) return begin(row, source);
  if (policy === "join") return current.promise;
  if (current.trailing) {
    current.trailing.row = row;
    current.trailing.source = source;
    return current.trailing.promise;
  }
  let resolve!: (result: IndexRegistryResult) => void;
  const promise = new Promise<IndexRegistryResult>((r) => (resolve = r));
  current.trailing = { row, source, promise, resolve };
  return promise;
}
