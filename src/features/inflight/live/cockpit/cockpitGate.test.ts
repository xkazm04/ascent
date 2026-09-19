// The gate the loop and the drive SHARE. The assertion that mattered was: any input that blocks a run
// must block a drive, because a drive is a sequence of runs with the same blast radius.
//
// ADR-0001 SPLITS THAT INTO A CONTAINMENT RATHER THAN AN EQUALITY, and the new invariant is pinned at
// the bottom of this file: a drive still implies dispatch, but dispatch no longer implies a drive. A
// HOSTED org may start a run — Ascent Cloud gets the lanes worked, nothing spawns here — while having
// no paired working copy for a drive to sequence runs in. Widening the drive to match the run is now
// the failure mode this file exists to make impossible, and `canDriveLocally` is how a caller says
// which of the two it meant.

import { describe, expect, it } from "vitest";
import {
  canDispatch,
  canDriveLocally,
  cockpitDispatchMode,
  cockpitSetupState,
  type CockpitGateInput,
  type HostedDispatchFact,
} from "./cockpitGate";

const ok: CockpitGateInput = { selfHosted: true, repoCount: 4, isOwner: true, enabled: true, pairedCount: 2 };

/** A cloud org the server says may dispatch. `available` is the deployment's answer, `enabled` the org's. */
const dispatchable: HostedDispatchFact = { enabled: true, reason: null, available: true };
/** A cloud deployment that DOES operate a worker, refusing this particular org. */
const refused: HostedDispatchFact = { enabled: false, reason: "Add credits to dispatch one.", available: true };
/** A cloud deployment operating no worker at all — nothing the org does will help. */
const noWorker: HostedDispatchFact = { enabled: false, reason: "This deployment operates no hosted worker.", available: false };

/** A cloud org: no self-hosting, no ASCENT_AUTOPILOT, no pairing — none of which it can ever have. */
const cloud: CockpitGateInput = { selfHosted: false, repoCount: 4, isOwner: true, enabled: false, pairedCount: 0 };

describe("cockpitSetupState", () => {
  it("clears when every condition the routes enforce is met", () => {
    expect(cockpitSetupState(ok)).toBeNull();
  });

  it.each<[string, Partial<CockpitGateInput>, string]>([
    ["managed cloud has no loop at all", { selfHosted: false }, "hosted"],
    ["nothing scanned yet", { repoCount: 0 }, "no-repos"],
    ["a member may read but not dispatch", { isOwner: false }, "not-owner"],
    ["ASCENT_AUTOPILOT is off", { enabled: false }, "autopilot-off"],
    ["no working copy to edit", { pairedCount: 0 }, "unpaired"],
  ])("names the single next action when %s", (_why, over, expected) => {
    expect(cockpitSetupState({ ...ok, ...over })).toBe(expected);
  });

  it("reports the OUTERMOST block first — self-hosting before anything it would gate", () => {
    expect(cockpitSetupState({ selfHosted: false, repoCount: 0, isOwner: false, enabled: false, pairedCount: 0 })).toBe("hosted");
  });
});

// ── ADR-0001: the server's `hosted` fact replaces the browser's `selfHosted` inference ────────────
//
// THE DEFECT THIS SECTION PINS. The gate used to answer `if (!selfHosted) return "hosted"`, so a
// cloud owner who could already arm a run was shown a self-hosting guide — deployment mode read off
// the page is not the question "may this organization dispatch". The server answers that now.
describe("cockpitSetupState — the hosted branch", () => {
  it("clears the rail for a cloud org the server says may dispatch", () => {
    expect(cockpitSetupState({ ...cloud, hosted: dispatchable })).toBeNull();
  });

  // The two cloud cards, and the split between them is `available`. A deployment with no worker
  // offers the reader nothing to fix and keeps the original self-hosting card; one that has a worker
  // is saying something specific about THIS org, which deserves its own card and its own next action.
  it("distinguishes a deployment with no worker from an org that may not use one", () => {
    expect(cockpitSetupState({ ...cloud, hosted: noWorker })).toBe("hosted");
    expect(cockpitSetupState({ ...cloud, hosted: refused })).toBe("hosted-not-enabled");
  });

  // AN ABSENT ANSWER IS NEVER A YES. An older server, or the first render before the status poll has
  // landed, must behave exactly as the gate did before the field existed.
  it("falls back to the original card when the server did not answer", () => {
    expect(cockpitSetupState(cloud)).toBe("hosted");
    expect(cockpitSetupState({ ...cloud, hosted: null })).toBe("hosted");
  });

  // The two checks that are about the ORG rather than about this server's disk still apply to a
  // hosted tenant, for exactly the reasons they apply to a local one.
  it("still applies the repo and ownership checks to a hosted org", () => {
    expect(cockpitSetupState({ ...cloud, hosted: dispatchable, repoCount: 0 })).toBe("no-repos");
    expect(cockpitSetupState({ ...cloud, hosted: dispatchable, isOwner: false })).toBe("not-owner");
  });

  // ...and the two that are NOT facts about a hosted tenant must never be shown to one. There is no
  // ASCENT_AUTOPILOT on a customer's cloud org and no directory for it to be paired to, so either
  // card would name an action the reader cannot take.
  it("never asks a hosted org about ASCENT_AUTOPILOT or a local pairing", () => {
    expect(cockpitSetupState({ ...cloud, hosted: dispatchable, enabled: false, pairedCount: 0 })).toBeNull();
  });

  // A self-hosted deployment's answer must not change because the field arrived. Its lanes still
  // spawn `claude -p` in a real checkout, and both checks still stand.
  it("leaves the self-hosted path exactly as it was", () => {
    expect(cockpitSetupState({ ...ok, hosted: dispatchable })).toBeNull();
    expect(cockpitSetupState({ ...ok, hosted: dispatchable, enabled: false })).toBe("autopilot-off");
    expect(cockpitSetupState({ ...ok, hosted: dispatchable, pairedCount: 0 })).toBe("unpaired");
  });
});

describe("cockpitDispatchMode", () => {
  it("names which engine a cleared cockpit would use", () => {
    expect(cockpitDispatchMode(ok)).toBe("local");
    expect(cockpitDispatchMode({ ...cloud, hosted: dispatchable })).toBe("hosted");
  });

  it("is null whenever anything blocks", () => {
    expect(cockpitDispatchMode({ ...cloud, hosted: refused })).toBeNull();
    expect(cockpitDispatchMode({ ...ok, isOwner: false })).toBeNull();
  });
});

describe("canDispatch / canDriveLocally", () => {
  const cases: CockpitGateInput[] = [
    ok,
    { ...ok, selfHosted: false },
    { ...ok, repoCount: 0 },
    { ...ok, isOwner: false },
    { ...ok, enabled: false },
    { ...ok, pairedCount: 0 },
    { ...cloud, hosted: dispatchable },
    { ...cloud, hosted: refused },
    { ...cloud, hosted: noWorker },
    cloud,
  ];

  it("is exactly the negation of a setup state — one gate, two callers", () => {
    for (const c of cases) expect(canDispatch(c)).toBe(cockpitSetupState(c) == null);
  });

  // THE CONTAINMENT THAT REPLACED THE EQUALITY. A drive is a sequence of LOCAL runs, each spawning
  // an agent inside a paired working copy on this server, so anything that may drive may certainly
  // dispatch. The converse is what ADR-0001 broke on purpose.
  it("never offers a drive where it would not offer a run", () => {
    for (const c of cases) if (canDriveLocally(c)) expect(canDispatch(c)).toBe(true);
  });

  it("offers a hosted org a run and withholds the drive", () => {
    const hostedOrg = { ...cloud, hosted: dispatchable };
    expect(canDispatch(hostedOrg)).toBe(true);
    expect(canDriveLocally(hostedOrg)).toBe(false);
  });

  it("still offers both to a cleared self-hosted deployment", () => {
    expect(canDispatch(ok)).toBe(true);
    expect(canDriveLocally(ok)).toBe(true);
  });
});
