// ADR-0001 T2 — the ceiling in front of every DISPATCH, not just every arm, and the status facts the
// cockpit reads. The ceiling state is injected or mocked; the dispatcher is a real registration.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ selfHosted: () => false }));
vi.mock("@/lib/db/hosted-credits", () => ({ readHostedCeilingState: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-admission", () => ({ readRepoAdmission: vi.fn(async () => null) }));

import { dispatchHostedLane, hostedFactsFrom } from "./hosted-dispatch";
import { setLaneDispatcher, type HostedLaneRef } from "./lane-dispatcher";
import type { HostedCeilingState } from "@/lib/db/hosted-credits";
import { HOSTED_LANE_CREDITS as L } from "./hosted-ceiling";

const lane: HostedLaneRef = { runId: "run-1", laneId: "lane-1", orgSlug: "acme", repoFullName: "acme/web", cycle: 1, batchIds: [] };
const within: HostedCeilingState = { orgExists: true, plan: "team", unlimited: false, balance: 0, spentThisMonth: 200, ceiling: 200 };

function register() {
  const d = { id: "test-runner", dispatch: vi.fn(async (_lane: HostedLaneRef) => ({ ok: true, reason: null as string | null })) };
  setLaneDispatcher(d);
  return d;
}

afterEach(() => setLaneDispatcher(null));

describe("dispatchHostedLane", () => {
  it("hands a lane within the ceiling to the dispatcher", async () => {
    const d = register();
    await expect(dispatchHostedLane(lane, { state: async () => within })).resolves.toEqual({ ok: true, reason: null });
    expect(d.dispatch).toHaveBeenCalledWith(lane);
  });

  // The balance is not re-checked here: this lane's credits were debited when it was armed.
  it("does not refuse on a zero balance — the lane was paid for at arm time", async () => {
    const d = register();
    await dispatchHostedLane(lane, { state: async () => ({ ...within, balance: 0 }) });
    expect(d.dispatch).toHaveBeenCalled();
  });

  it.each<[string, HostedCeilingState | null]>([
    ["the org is past its ceiling (a downgrade after arming, or an overshoot)", { ...within, spentThisMonth: 200 + L }],
    ["the org is no longer entitled", { ...within, plan: "pro" }],
    ["the spend cannot be read", null],
    ["the org no longer exists", { ...within, orgExists: false }],
  ])("refuses, as data, and never calls the dispatcher when %s", async (_why, state) => {
    const d = register();
    const res = await dispatchHostedLane(lane, { state: async () => state });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/\.$/);
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("treats a THROWING spend read as unreadable, not as a pass", async () => {
    const d = register();
    const res = await dispatchHostedLane(lane, { state: async () => Promise.reject(new Error("db down")) });
    expect(res.ok).toBe(false);
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("refuses with no dispatcher registered, before reading any spend", async () => {
    const state = vi.fn(async () => within);
    const res = await dispatchHostedLane(lane, { state });
    expect(res.ok).toBe(false);
    expect(state).not.toHaveBeenCalled();
  });
});

describe("hostedFactsFrom", () => {
  const room: HostedCeilingState = { orgExists: true, plan: "team", unlimited: false, balance: L, spentThisMonth: 0, ceiling: 200 };

  it("opens both money gates when one more lane fits the ceiling and the balance", () => {
    expect(hostedFactsFrom(room, true)).toEqual({ orgExists: true, dispatcherAvailable: true, entitled: true, ceilingHeadroom: true, creditHeadroom: true });
  });

  it("shuts the ceiling gate when one more lane would cross it", () => {
    expect(hostedFactsFrom({ ...room, spentThisMonth: 200 }, true)).toMatchObject({ ceilingHeadroom: false });
  });

  it("shuts the credit gate when the balance cannot cover one lane's reservation", () => {
    expect(hostedFactsFrom({ ...room, balance: L - 1 }, true)).toMatchObject({ ceilingHeadroom: true, creditHeadroom: false });
  });

  it("reads an unreadable state as a refusal on every gate", () => {
    expect(hostedFactsFrom(null, true)).toMatchObject({ orgExists: false, entitled: false, ceilingHeadroom: false, creditHeadroom: false });
  });
});
