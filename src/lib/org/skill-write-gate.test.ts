// The door x tier TABLE test for the one Skills-write entitlement decision.
//
// This file is the proof that replaced four hand-copied inline chains: every (door, plan, kind,
// live-count) cell asserts ONE named decision in one place, so the declared push exception is
// readable as a row rather than inferred from a paragraph. Three invariants it pins on purpose:
//   - the decision is ENUMERATED, never a boolean — a refusal names which of the three facts refused;
//   - the push door is closed to a personal workspace while create, with identical state, is open;
//   - it FAILS CLOSED — a door the table has no row for refuses, and a fifth door added to the union
//     without a row fails typecheck (the `@ts-expect-error` below is that assertion).

import { describe, it, expect, vi } from "vitest";

const { mockGetCreditState, mockIsPersonalOrg, mockGetPersonalUsage } = vi.hoisted(() => ({
  mockGetCreditState: vi.fn(),
  mockIsPersonalOrg: vi.fn(),
  mockGetPersonalUsage: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getCreditState: mockGetCreditState,
  isPersonalOrg: mockIsPersonalOrg,
  getPersonalUsage: mockGetPersonalUsage,
  PERSONAL_SKILL_LIMIT: 10,
}));

import {
  isSkillWriteDoor,
  skillWriteDecision,
  skillWriteDenial,
  skillWriteGate,
  SKILL_WRITE_DOORS,
  type SkillWriteDoor,
  type SkillWriteDoorRule,
  type SkillWriteRefusal,
  type SkillWriteState,
} from "@/lib/org/skill-write-gate";

const DOORS: SkillWriteDoor[] = ["create", "edit", "promote", "push"];

const team: SkillWriteState = { planAllows: true, personal: false, liveSkills: 0 };
const freeOrg: SkillWriteState = { planAllows: false, personal: false, liveSkills: 0 };
const freePersonal = (liveSkills: number): SkillWriteState => ({ planAllows: false, personal: true, liveSkills });

describe("skillWriteDecision — the named decision", () => {
  it("create on a free PERSONAL workspace below the cap is a personal allowance with the headroom", () => {
    expect(skillWriteDecision("create", freePersonal(3))).toEqual({
      allowed: true,
      decision: "personal-allowance",
      limit: 10,
      remaining: 7,
    });
  });

  it("create at the cap refuses by NAME, carrying the limit (not a bare false)", () => {
    expect(skillWriteDecision("create", freePersonal(10))).toEqual({
      allowed: false,
      decision: "cap-reached",
      limit: 10,
    });
  });

  it("push is closed to a personal workspace while create with IDENTICAL state is open", () => {
    const state = freePersonal(3);
    expect(skillWriteDecision("push", state)).toEqual({ allowed: false, decision: "personal-door-closed" });
    expect(skillWriteDecision("create", state).allowed).toBe(true);
  });

  it("edit ignores the cap — an edit replaces a row, it does not grow the library", () => {
    expect(skillWriteDecision("edit", freePersonal(10))).toMatchObject({
      allowed: true,
      decision: "personal-allowance",
    });
    expect(skillWriteDecision("promote", freePersonal(10))).toMatchObject({ decision: "cap-reached" });
  });
});

describe("the door x tier table — every cell asserted here and nowhere else", () => {
  it.each(DOORS)("a Team+ plan opens %s", (door) => {
    expect(skillWriteDecision(door, team)).toEqual({ allowed: true, decision: "plan-allows" });
  });

  it.each(DOORS)("a free NON-personal org is refused at %s with plan-required", (door) => {
    expect(skillWriteDecision(door, freeOrg)).toEqual({ allowed: false, decision: "plan-required" });
  });

  it.each(DOORS)("%s on a free personal workspace decides from its own row", (door) => {
    const rule = SKILL_WRITE_DOORS[door];
    const below = skillWriteDecision(door, freePersonal(3));
    const atCap = skillWriteDecision(door, freePersonal(10));
    if (!rule.personalPath) {
      expect(below.decision).toBe("personal-door-closed");
      expect(atCap.decision).toBe("personal-door-closed");
      return;
    }
    expect(below.decision).toBe("personal-allowance");
    expect(atCap.decision).toBe(rule.capApplies ? "cap-reached" : "personal-allowance");
  });

  it("has a row for every door in the closed union", () => {
    expect(Object.keys(SKILL_WRITE_DOORS).sort()).toEqual([...DOORS].sort());
    expect(DOORS.every(isSkillWriteDoor)).toBe(true);
  });

  it("is TOTAL over the union: a fifth door without a row does not typecheck", () => {
    // @ts-expect-error — "transfer" has no row, so the table is not assignable to a Record that
    // includes it. Adding a member to SkillWriteDoor without a row breaks `tsc` the same way, which
    // is what stops a fifth write path shipping with an undeclared entitlement rule.
    const widened: Record<SkillWriteDoor | "transfer", SkillWriteDoorRule> = SKILL_WRITE_DOORS;
    expect(widened).toBeDefined();
  });
});

describe("fail closed", () => {
  it("refuses a door the table has no row for", () => {
    const rogue = "transfer" as SkillWriteDoor;
    expect(skillWriteDecision(rogue, team)).toEqual({ allowed: false, decision: "unknown-door" });
    expect(skillWriteDecision(rogue, freePersonal(0))).toEqual({ allowed: false, decision: "unknown-door" });
    expect(isSkillWriteDoor("transfer")).toBe(false);
  });

  it("skillWriteGate refuses an unknown door without reading any state", async () => {
    vi.clearAllMocks();
    const d = await skillWriteGate("acme", "transfer" as SkillWriteDoor);
    expect(d).toEqual({ allowed: false, decision: "unknown-door" });
    expect(mockGetCreditState).not.toHaveBeenCalled();
  });
});

describe("skillWriteDenial — the status codes the CLI reads", () => {
  it("maps each refusal to its status and carries the decision name in the body", () => {
    const cases: [SkillWriteRefusal, number][] = [
      [{ allowed: false, decision: "plan-required" }, 403],
      [{ allowed: false, decision: "personal-door-closed" }, 403],
      [{ allowed: false, decision: "cap-reached", limit: 10 }, 402],
      [{ allowed: false, decision: "unknown-door" }, 403],
    ];
    for (const [refusal, status] of cases) {
      const denial = skillWriteDenial(refusal);
      expect(denial.status).toBe(status);
      expect(denial.body.decision).toBe(refusal.decision);
      expect(denial.body.error.length).toBeGreaterThan(0);
    }
  });

  it("keeps the cap message verbatim (the 402 the CLI already parses)", () => {
    expect(skillWriteDenial({ allowed: false, decision: "cap-reached", limit: 10 }).body.error).toBe(
      "Personal skills are capped at 10. Archive one to author another.",
    );
  });
});

describe("skillWriteGate — state resolution", () => {
  it("short-circuits a Team plan before any personal read", async () => {
    vi.clearAllMocks();
    mockGetCreditState.mockResolvedValue({ plan: "team" });
    expect(await skillWriteGate("acme", "push")).toEqual({ allowed: true, decision: "plan-allows" });
    expect(mockIsPersonalOrg).not.toHaveBeenCalled();
    expect(mockGetPersonalUsage).not.toHaveBeenCalled();
  });

  it("reads the live count only for a door whose cap applies", async () => {
    vi.clearAllMocks();
    mockGetCreditState.mockResolvedValue({ plan: "free" });
    mockIsPersonalOrg.mockResolvedValue(true);
    mockGetPersonalUsage.mockResolvedValue({ skills: { used: 9, limit: 10 } });
    expect(await skillWriteGate("me", "create")).toMatchObject({ decision: "personal-allowance", remaining: 1 });
    expect(mockGetPersonalUsage).toHaveBeenCalledTimes(1);
    expect(await skillWriteGate("me", "edit")).toMatchObject({ decision: "personal-allowance" });
    expect(mockGetPersonalUsage).toHaveBeenCalledTimes(1);
  });

  it("a failed credit read degrades to the free path, never to an open door", async () => {
    vi.clearAllMocks();
    mockGetCreditState.mockRejectedValue(new Error("db down"));
    mockIsPersonalOrg.mockResolvedValue(false);
    expect(await skillWriteGate("acme", "create")).toEqual({ allowed: false, decision: "plan-required" });
  });
});
