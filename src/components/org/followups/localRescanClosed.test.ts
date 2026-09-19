// Local Rescan's close count is persist's adjudicated set. Trailer claims on the same body must
// never add to it — the bug this pins is the button totaling `resolvedFollowUpIds` (the claim set).

import { describe, expect, it } from "vitest";
import { persistClosedCaption, persistClosedFollowUps } from "./localRescanClosed";

describe("persistClosedFollowUps — the Local Rescan count, never the trailer set", () => {
  it("counts persist-closed ids and ignores claimedFollowUps / leftover trailer fields", () => {
    const mixed = {
      closedFollowUps: ["gap-1"],
      claimedFollowUps: ["gap-1", "gap-2", "gap-3"],
      resolvedFollowUps: ["gap-1", "gap-2", "gap-3"],
    };
    expect(persistClosedFollowUps(mixed)).toEqual(["gap-1"]);
    expect(persistClosedFollowUps({ closedFollowUps: [] })).toEqual([]);
    expect(persistClosedFollowUps({ closedFollowUps: ["gap-1", "gap-9"] })).toEqual(["gap-1", "gap-9"]);
  });

  it("treats a missing body as zero closes — nothing was adjudicated", () => {
    expect(persistClosedFollowUps(undefined)).toEqual([]);
    expect(persistClosedFollowUps(null)).toEqual([]);
    expect(persistClosedFollowUps({})).toEqual([]);
  });
});

describe("persistClosedCaption", () => {
  it("does not say 'no trailers found' when persist closed nothing", () => {
    const caption = persistClosedCaption(0);
    expect(caption).not.toMatch(/no trailers found/i);
    expect(caption).toMatch(/claim/i);
    expect(persistClosedCaption(1)).toBe("1 follow-up closed ✓");
    expect(persistClosedCaption(2)).toBe("2 follow-ups closed ✓");
  });
});
