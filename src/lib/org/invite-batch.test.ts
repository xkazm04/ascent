// The batch-invite classifier (members-1). One pure function runs twice: in the browser for the
// instant preview, and on the server as the authority. These cases pin both halves of that contract:
// how pasted text becomes targets, and how a target is judged against the roster and the pending list.

import { describe, expect, it } from "vitest";
import {
  INVITE_BATCH_MAX,
  classifyInviteTargets,
  countInvitePlan,
  isEmailTarget,
  parseInviteTargets,
} from "./invite-batch";

describe("parseInviteTargets", () => {
  it("splits on comma, semicolon, space and newline; drops a leading @; lower-cases; reports repeats", () => {
    expect(parseInviteTargets("alice, Bob@x.io\n@carol  alice;dave")).toEqual({
      targets: ["alice", "bob@x.io", "carol", "dave"],
      duplicates: ["alice"],
    });
  });

  it("an empty or separator-only paste yields nothing", () => {
    expect(parseInviteTargets("  ,;\n ")).toEqual({ targets: [], duplicates: [] });
  });

  it("a repeat that differs only by case or a leading @ is still a repeat", () => {
    expect(parseInviteTargets("Alice @alice ALICE")).toEqual({ targets: ["alice"], duplicates: ["alice", "alice"] });
  });
});

describe("classifyInviteTargets", () => {
  const members = [{ login: "bob", role: "admin" as const }];
  const pending = [
    { id: "i1", githubLogin: "carol", email: null },
    { id: "i2", githubLogin: null, email: "EVE@x.io" },
  ];

  it("judges each target against the roster and the pending list, in input order", () => {
    expect(classifyInviteTargets(["alice", "bob", "carol", "x y!", "eve@x.io"], members, pending)).toEqual([
      { target: "alice", kind: "login", outcome: "invite" },
      { target: "bob", kind: "login", outcome: "already_member", role: "admin" },
      { target: "carol", kind: "login", outcome: "already_pending", inviteId: "i1" },
      { target: "x y!", kind: null, outcome: "invalid" },
      { target: "eve@x.io", kind: "email", outcome: "already_pending", inviteId: "i2" },
    ]);
  });

  it("matches a member login case-insensitively and an email-shaped login is not a login", () => {
    const rows = classifyInviteTargets(["BOB", "bob@example"], members, []);
    expect(rows[0]).toMatchObject({ outcome: "already_member", role: "admin" });
    expect(rows[1]).toMatchObject({ outcome: "invalid", kind: null });
  });

  it("a second occurrence of the same target is a duplicate, so the server never mints two", () => {
    const rows = classifyInviteTargets(["alice", "Alice"], [], []);
    expect(rows.map((r) => r.outcome)).toEqual(["invite", "duplicate"]);
  });

  it("counts the plan by outcome", () => {
    const rows = classifyInviteTargets(["alice", "dave", "bob", "carol"], members, pending);
    expect(countInvitePlan(rows)).toEqual({ invite: 2, already_member: 1, already_pending: 1, invalid: 0, duplicate: 0 });
  });
});

describe("shape helpers", () => {
  it("caps a batch at 25 and tells an email from a login", () => {
    expect(INVITE_BATCH_MAX).toBe(25);
    expect(isEmailTarget("a@b.io")).toBe(true);
    expect(isEmailTarget("octocat")).toBe(false);
  });
});
