// THE DISPATCH SEAM (ADR-0001 §1) — the one interface between "a hosted lane exists" and "something
// somewhere is working it".
//
// Ascent never executes agent code inside its own request path. `startHostedRun` writes lanes and
// stops; a worker elsewhere claims them through the MCP work tools, exactly as a customer's own
// `remote-agent` harness already does. What this module adds is the seam where Ascent Cloud becomes
// the FIRST-PARTY client of that protocol: a `LaneDispatcher` is handed a queued hosted lane and is
// responsible only for telling some runner it exists.
//
// WHY AN INTERFACE RATHER THAN A CALL. ADR-0001 weighed a container fleet (alternative A) and a
// third-party queue (alternative C) and deferred both — not rejected them. Both become a second
// implementation of `dispatch()` rather than a rewrite of the arm path, and that is the entire
// purpose of this file.
//
// NOTHING IS REGISTERED BY DEFAULT, AND THAT IS THE SAFETY PROPERTY. A deployment with no dispatcher
// reports `hostedDispatchAvailable() === false`, the status route says so, the cockpit says so, and
// `startHostedRun` refuses. A hosted lane therefore cannot be armed on a deployment that has no way
// to work it — and, because registering a dispatcher is what turns hosted dispatch on, the metering
// and per-lane spend ceiling ADR-0001 calls a precondition are enforced by NOT registering one until
// they exist. There is no code path here that can spend money.
//
// THE REGISTRY IS ON `globalThis`, for the same reason the loop engine's live-run registry is: Next
// bundles each API route into its own server chunk, so a module-level `let` is instantiated once PER
// CHUNK and a dispatcher installed from the boot path would be invisible to the route that needs it
// (the 2026-08-26 hazard recorded in loop-engine.ts:103-110).

/** The lane a dispatcher is asked to get worked. Everything a runner needs to claim it over MCP. */
export interface HostedLaneRef {
  runId: string;
  laneId: string;
  orgSlug: string;
  repoFullName: string;
  cycle: number;
  /** The Recommendation ids this lane was armed with. Empty = the worker picks its own batch. */
  batchIds: string[];
}

/** What a dispatch attempt did. A refusal is DATA, never a throw: one lane that could not be handed
 *  off must not abort the drain of the rest. `reason` is shown to the operator verbatim. */
export interface DispatchResult {
  ok: boolean;
  reason: string | null;
}

export interface LaneDispatcher {
  /** Stable id, recorded on the run's audit row so "who was asked to do this" survives the process. */
  readonly id: string;
  /**
   * Hand ONE queued hosted lane to a runner and return. This must not block on the lane's work:
   * a dispatcher that waits for the agent has reintroduced exactly the in-request execution
   * ADR-0001 alternative B was rejected for.
   */
  dispatch(lane: HostedLaneRef): Promise<DispatchResult>;
}

const KEY = "__ascentLaneDispatcher" as const;

type Slot = { current: LaneDispatcher | null };

const slot: Slot = ((globalThis as unknown as Record<string, unknown>)[KEY] ??= {
  current: null,
}) as Slot;

/** Install the deployment's dispatcher. Idempotent; the last caller wins. */
export function setLaneDispatcher(d: LaneDispatcher | null): void {
  slot.current = d;
}

/** The installed dispatcher, or null when this deployment operates no hosted worker. */
export function getLaneDispatcher(): LaneDispatcher | null {
  return slot.current;
}

/** Does this DEPLOYMENT operate a hosted worker at all? False is not an org-fixable condition. */
export function hostedDispatchAvailable(): boolean {
  return slot.current != null;
}
