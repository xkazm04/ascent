// The C3 share body contract (backlog develop-2026-09-17 row 46). Every refusal here is a body the
// tree had no door for before: known fields only, capped strings and lists, ISO dates, and two
// classes of key refused ANYWHERE in the payload (never-sent content, identity).

import { describe, expect, it } from "vitest";
import { CARE_SHARE_CAPS, careShareForbiddenKeys, validateCareShare } from "./care-share-contract";

const goodShare = () => ({
  contract: 1,
  profile: { role: "backend engineer", archetypeHint: "verifier", goals: ["fewer re-corrections"] },
  moves: [
    { id: "plan-mode", title: "Plan mode before multi-file work", state: "kept", category: "session", why: "9 of 14 sessions re-corrected", expectedSaving: 95, tryFor: null, registryPromotable: true, at: "2026-09-20T10:00:00Z" },
    { id: "allowlist", title: "Allowlist six commands", state: "dropped", category: "tooling", why: "41 prompts", expectedSaving: null, tryFor: null, droppedReason: "security review", at: "2026-09-18T10:00:00.000Z" },
  ],
  journal: [
    { at: "2026-09-10T08:00:00.000Z", line: "older line", kind: "weekly" },
    { at: "2026-09-21T08:00:00.000Z", line: "newer line", kind: "retro" },
  ],
  shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 2, fields: { sessionsPerWeek: 3, planModePct: 62 } },
  setup: { hookInstalled: true },
});

const refused = (body: unknown) => {
  const r = validateCareShare(body);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.errors;
};

describe("validateCareShare: accepts", () => {
  it("a full share, with dates re-emitted as ISO strings and the journal newest first", () => {
    const r = validateCareShare(goodShare());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.share.moves?.[0]?.at).toBe("2026-09-20T10:00:00.000Z");
    expect(r.share.journal?.map((e) => e.line)).toEqual(["newer line", "older line"]);
    expect(r.share.moves?.[1]?.droppedReason).toBe("security review");
  });

  it("a share of one section only", () => {
    expect(validateCareShare({ contract: 1, journal: [] }).ok).toBe(true);
  });
});

describe("validateCareShare: refuses never-sent content at any depth", () => {
  it.each([
    ["transcript at the top", { ...goodShare(), transcript: "SECRET" }],
    ["prompts inside a move", { ...goodShare(), moves: [{ ...goodShare().moves[0], prompts: ["SECRET"] }] }],
    ["file contents inside a journal entry", { ...goodShare(), journal: [{ at: "2026-09-21T08:00:00Z", line: "x", fileContents: "SECRET" }] }],
    ["a diff in the setup", { ...goodShare(), setup: { hookInstalled: true, diff: "+x" } }],
  ])("%s", (_name, body) => {
    const errors = refused(body);
    expect(errors.every((e) => e.startsWith("never-sent field:"))).toBe(true);
  });

  it("matches the key whatever its case or separators", () => {
    expect(careShareForbiddenKeys({ a: { File_Contents: 1, TRANSCRIPT: 2 } }).neverSent).toEqual(["a.File_Contents", "a.TRANSCRIPT"]);
  });
});

describe("validateCareShare: the payload never names whose data it is", () => {
  it.each([["login"], ["email"], ["user"], ["githubLogin"]])("refuses %s", (key) => {
    const errors = refused({ ...goodShare(), [key]: "someone-else" });
    expect(errors[0]).toMatch(/^identity field:/);
  });

  it("refuses an identity key nested in the profile", () => {
    expect(refused({ ...goodShare(), profile: { ...goodShare().profile, owner: "ada" } })[0]).toMatch(/^identity field: profile.owner/);
  });
});

describe("validateCareShare: known fields, types and caps", () => {
  it("refuses an unknown top-level key and an unknown move key", () => {
    expect(refused({ ...goodShare(), extra: 1 })).toContain("payload: unknown key extra");
    expect(refused({ ...goodShare(), moves: [{ ...goodShare().moves[0], evidence: "fleet says" }] })).toContain("moves[0]: unknown key evidence");
  });

  it("refuses another contract version and a non-object", () => {
    expect(refused({ ...goodShare(), contract: 2 })).toContain("contract must be 1");
    expect(refused([goodShare()])).toEqual(["payload is not an object"]);
  });

  it("refuses over-long strings and over-long lists", () => {
    expect(refused({ contract: 1, journal: [{ at: "2026-09-21T08:00:00Z", line: "x".repeat(CARE_SHARE_CAPS.line + 1) }] })[0]).toMatch(/longer than/);
    const many = Array.from({ length: CARE_SHARE_CAPS.moves + 1 }, (_, i) => ({ ...goodShare().moves[0], id: `m${i}` }));
    expect(refused({ contract: 1, moves: many })[0]).toMatch(/at most/);
    expect(refused({ contract: 1, profile: { role: null, archetypeHint: null, goals: Array(CARE_SHARE_CAPS.goals + 1).fill("g") } })[0]).toMatch(/at most/);
  });

  it("refuses wrong types, unknown enums, bad dates and duplicate move ids", () => {
    const m = goodShare().moves[0];
    expect(refused({ contract: 1, moves: [{ ...m, state: "done" }] })).toContain("moves[0].state: unknown state");
    expect(refused({ contract: 1, moves: [{ ...m, expectedSaving: -1 }] })[0]).toMatch(/expectedSaving/);
    expect(refused({ contract: 1, moves: [{ ...m, at: "yesterday" }] })).toContain("moves[0].at: must be an ISO date");
    expect(refused({ contract: 1, moves: [m, m] })).toContain("moves: every id must be unique");
    expect(refused({ contract: 1, setup: { hookInstalled: "yes" } })).toContain("setup.hookInstalled: must be a boolean");
    expect(refused({ contract: 1, profile: { role: null, archetypeHint: "wizard", goals: [] } })[0]).toMatch(/archetypeHint/);
  });

  it("refuses a shape the shape contract refuses, and says which section", () => {
    const shape = { ...goodShare().shape, windowDays: 90 };
    expect(refused({ contract: 1, shape })).toContain("shape: windowDays must be 30");
  });
});
