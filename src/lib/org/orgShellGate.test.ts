// W6b: the org shell's empty-org gate. The layout is an async server component the suite can't
// render, so the DECISION is pure and pinned here — especially the two edges the wall used to
// protect: a non-member's view of an empty org, and a slug with no org row at all.

import { describe, it, expect } from "vitest";
import { resolveOrgShellState } from "./orgShellGate";

describe("resolveOrgShellState", () => {
  it("renders the full shell with the first-scan empty state for a MEMBER's zero-repo fleet org", () => {
    expect(resolveOrgShellState({ summary: { repoCount: 0, kind: "fleet" }, isMember: true })).toBe("first-scan");
  });

  it("keeps the wall for a NON-member (anon / simple-wall browser) on a zero-repo org — unchanged behavior", () => {
    expect(resolveOrgShellState({ summary: { repoCount: 0, kind: "fleet" }, isMember: false })).toBe("wall");
  });

  it("keeps the wall when there is no org row at all, member standing or not", () => {
    expect(resolveOrgShellState({ summary: null, isMember: true })).toBe("wall");
    expect(resolveOrgShellState({ summary: null, isMember: false })).toBe("wall");
  });

  it("keeps the personal-workspace behavior: shell at zero repos (its overview IS the empty state)", () => {
    expect(resolveOrgShellState({ summary: { repoCount: 0, kind: "personal" }, isMember: true })).toBe("shell");
    // Personal shells never walled on emptiness before W6b either — membership standing is not what
    // admits them (canReadOrg upstream already did).
    expect(resolveOrgShellState({ summary: { repoCount: 0, kind: "personal" }, isMember: false })).toBe("shell");
  });

  it("renders the normal shell for any populated org", () => {
    expect(resolveOrgShellState({ summary: { repoCount: 3, kind: "fleet" }, isMember: false })).toBe("shell");
    expect(resolveOrgShellState({ summary: { repoCount: 1, kind: "personal" }, isMember: true })).toBe("shell");
  });
});
