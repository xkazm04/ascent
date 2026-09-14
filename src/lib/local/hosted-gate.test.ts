// ADR-0001 §2's GATE TABLE, walked as a table. The module under test is pure — no Prisma, no env, no
// clock — which is the whole reason it was split out of the IO half: the mapping from "self-hosted
// checks" to "cloud tenancy facts" is the decision this work has to get right, and a decision that
// can only be exercised through four mocked database modules does not get read again after it lands.
//
// What it pins:
//   • the ORDER of the blocks, which is a product statement and not an implementation detail;
//   • that every block has a distinct HTTP status, so the caller's fix is named by the code alone;
//   • that a reason is always a sentence naming an action, never an empty string;
//   • that `enabled` and `available` are different answers, because the cockpit renders two cards.

import { describe, expect, it } from "vitest";
import {
  hostedBlockReason,
  hostedBlockStatus,
  hostedDispatchStatus,
  hostedGateBlock,
  type HostedBlock,
  type HostedGateFacts,
} from "./hosted-gate";

/** Every gate open. Each case below closes exactly one, so a failure names the row that moved. */
const open: HostedGateFacts = { orgExists: true, dispatcherAvailable: true, entitled: true, creditHeadroom: true };

describe("hostedGateBlock", () => {
  it("passes an org with every gate open", () => {
    expect(hostedGateBlock(open)).toBeNull();
  });

  const cases: [string, Partial<HostedGateFacts>, HostedBlock][] = [
    ["an org that does not exist", { orgExists: false }, "unknown-org"],
    ["a deployment operating no hosted worker", { dispatcherAvailable: false }, "no-dispatcher"],
    ["a plan without the hostedLoop capability", { entitled: false }, "not-entitled"],
    ["an org with no credit headroom", { creditHeadroom: false }, "no-credit"],
  ];
  it.each(cases)("blocks %s", (_label, over, expected) => {
    expect(hostedGateBlock({ ...open, ...over })).toBe(expected);
  });

  // THE ORDER IS THE POINT, not an accident of the if-chain. Telling an org to upgrade its plan for a
  // capability this deployment does not operate would be selling them something undeliverable, so
  // `no-dispatcher` has to outrank `not-entitled` even when both are true.
  it("reports the deployment's own gap before the tenant's, when both are shut", () => {
    expect(hostedGateBlock({ ...open, dispatcherAvailable: false, entitled: false })).toBe("no-dispatcher");
  });

  it("reports a missing org before anything else — there is no tenant to judge yet", () => {
    expect(hostedGateBlock({ orgExists: false, dispatcherAvailable: false, entitled: false, creditHeadroom: false })).toBe("unknown-org");
  });

  // Money last among the org-level gates: an org that is not entitled cannot buy its way in with
  // credits, so naming the balance first would send the owner to the wrong page.
  it("reports entitlement before credit", () => {
    expect(hostedGateBlock({ ...open, entitled: false, creditHeadroom: false })).toBe("not-entitled");
  });
});

describe("hostedBlockStatus", () => {
  // Distinct codes on purpose: 402 is fixable with money, 403 with a decision, 409 not by the caller
  // at all. Collapsing them would tell an out-of-credit org that the server was busy.
  it("gives money, decision and not-yours their own codes", () => {
    expect(hostedBlockStatus("no-credit")).toBe(402);
    expect(hostedBlockStatus("not-entitled")).toBe(403);
    expect(hostedBlockStatus("repo-not-admitted")).toBe(403);
    expect(hostedBlockStatus("no-dispatcher")).toBe(409);
    expect(hostedBlockStatus("delivery-not-pr")).toBe(400);
    expect(hostedBlockStatus("unknown-org")).toBe(404);
  });

  // 404 is reserved. `selfHostGuard` answers 404 to mean "this surface does not exist here", and
  // hosted dispatch's whole premise is that it DOES exist on cloud — so a refusal must never borrow
  // that code to mean "refused". Only a missing org, which is genuinely absent, may answer 404.
  it("never answers 404 for a refusal that is not a missing org", () => {
    const refusals: HostedBlock[] = ["no-dispatcher", "not-entitled", "no-credit", "repo-not-admitted", "delivery-not-pr"];
    for (const b of refusals) expect(hostedBlockStatus(b)).not.toBe(404);
  });
});

describe("hostedBlockReason", () => {
  const all: HostedBlock[] = ["unknown-org", "no-dispatcher", "not-entitled", "no-credit", "repo-not-admitted", "delivery-not-pr"];

  it("gives every block a non-empty sentence", () => {
    for (const b of all) {
      const reason = hostedBlockReason(b);
      expect(reason.length).toBeGreaterThan(0);
      expect(reason.trim()).toBe(reason);
      expect(reason.endsWith(".")).toBe(true);
    }
  });

  // The string travels to the browser and is rendered verbatim, so a repo-specific refusal has to
  // name the repo — "that repository" in a list of nine is not an action.
  it("names the offending repository when it is given one", () => {
    expect(hostedBlockReason("repo-not-admitted", "acme/api")).toContain("acme/api");
  });

  it("still reads as a sentence when the repository is not given", () => {
    expect(hostedBlockReason("repo-not-admitted")).toContain("That repository");
  });
});

describe("hostedDispatchStatus", () => {
  it("is enabled with a null reason when every gate is open", () => {
    expect(hostedDispatchStatus(open)).toEqual({ enabled: true, reason: null, available: true });
  });

  // `reason` is null EXACTLY when enabled. The cockpit reads the pair, and a reason arriving with
  // `enabled: true` would render a wall next to a working Run button.
  it("carries a reason exactly when it is not enabled", () => {
    const blocked = hostedDispatchStatus({ ...open, entitled: false });
    expect(blocked.enabled).toBe(false);
    expect(blocked.reason).not.toBeNull();
  });

  // THE TWO-CARD SPLIT. `available` is about the DEPLOYMENT and `enabled` about the ORG, and the
  // cockpit shows a different card for each: nothing an org does fixes a deployment with no worker.
  it("separates 'this deployment cannot' from 'this org may not'", () => {
    expect(hostedDispatchStatus({ ...open, dispatcherAvailable: false })).toMatchObject({ enabled: false, available: false });
    expect(hostedDispatchStatus({ ...open, entitled: false })).toMatchObject({ enabled: false, available: true });
  });
});
