// THE REMOTE-AGENT ARM (backlog develop-2026-09-17 row 29). `POST /api/org/loop` has accepted
// `executor: "remote-agent"` on managed cloud since moonshot #3, but the cockpit's gate short-circuited
// every cloud deployment with no hosted worker into a card that only DESCRIBED that run: 0 of the
// hosted + owner + repos cases could start it from the page. The arm is a SEPARATE predicate from
// `canDispatch`, because a remote run spawns nothing on this server and has none of the local gates;
// the local dispatch and the drive stay exactly as closed as they were.

import { describe, expect, it } from "vitest";
import {
  canArmRemote,
  canDispatch,
  canDriveLocally,
  cockpitDispatchMode,
  cockpitSetupState,
  type CockpitGateInput,
  type HostedDispatchFact,
} from "./cockpitGate";

const noWorker: HostedDispatchFact = { enabled: false, reason: "This deployment operates no hosted worker.", available: false };
const refused: HostedDispatchFact = { enabled: false, reason: "Add credits to dispatch one.", available: true };

/** The finding's case: hosted, owner, ASCENT_AUTOPILOT reported on, repos scanned. */
const hostedOwner: CockpitGateInput = { selfHosted: false, repoCount: 3, isOwner: true, enabled: true, pairedCount: 0, hosted: noWorker };
/** The case managed cloud actually produces: `autopilotEnabled()` is false there by construction
 *  (`cliProviderAllowed()` is off in production unless self-hosted), and the remote route never reads it. */
const cloudOwner: CockpitGateInput = { ...hostedOwner, enabled: false };

describe("canArmRemote", () => {
  it("lets a hosted owner with repos arm a remote-agent run, whatever the hosted-worker answer", () => {
    for (const hosted of [noWorker, refused, null, undefined]) {
      expect(canArmRemote({ ...hostedOwner, hosted })).toBe(true);
      expect(canArmRemote({ ...cloudOwner, hosted })).toBe(true);
    }
  });

  it("offers a non-owner nothing: the route is owner-gated and a CTA that 403s is worse than none", () => {
    expect(canArmRemote({ ...hostedOwner, isOwner: false })).toBe(false);
  });

  it("offers nothing with no repos to scope a run to", () => {
    expect(canArmRemote({ ...hostedOwner, repoCount: 0 })).toBe(false);
  });

  it("guard: is a hosted-only door; a self-hosted deployment keeps its local Run", () => {
    expect(canArmRemote({ ...hostedOwner, selfHosted: true, pairedCount: 2 })).toBe(false);
  });
});

describe("the local gates stay shut on hosted while the remote arm opens", () => {
  it("guard: the hosted card still shows, so the self-hosting guide and the reason stay on screen", () => {
    expect(cockpitSetupState(hostedOwner)).toBe("hosted");
    expect(cockpitSetupState({ ...hostedOwner, hosted: refused })).toBe("hosted-not-enabled");
  });

  it("guard: local dispatch and the drive remain false for every hosted case the arm opens", () => {
    for (const c of [hostedOwner, cloudOwner, { ...hostedOwner, hosted: refused }, { ...hostedOwner, hosted: null }]) {
      expect(canArmRemote(c)).toBe(true);
      expect(cockpitDispatchMode(c)).not.toBe("local");
      expect(canDispatch(c)).toBe(false);
      expect(canDriveLocally(c)).toBe(false);
    }
  });
});
