// resolveWorkspace - the ONE rule for "which orgs may this viewer select, and which is active".
//
// The active org was written by one rule and read by another. POST /api/org/active validates with
// canReadOrg (membership under the Supabase wall), but getActiveOrg validated the cookie against the
// DORMANT custom-OAuth session's installations, which is never minted in production. So under the wall
// a remembered org could not be read back: every cookie resolved to "public". These cases pin the pure
// rule both identity stacks now feed: memberships and dormant installations are one option vocabulary.

import { describe, it, expect } from "vitest";
import { resolveWorkspace } from "./viewer-workspace-model";

describe("resolveWorkspace - options and active org from both identity stacks", () => {
  it("reads back a remembered org the viewer is a member of (the Supabase-wall case getActiveOrg lost)", () => {
    expect(
      resolveWorkspace({
        dormantSession: null,
        memberships: [
          { slug: "acme", role: "owner" },
          { slug: "beta", role: "viewer" },
        ],
        cookieOrg: "beta",
      }),
    ).toEqual({ options: ["acme", "beta", "public"], active: "beta" });
  });

  it("never selects a hand-set cookie for an org outside the options; falls back to the primary membership", () => {
    const ws = resolveWorkspace({
      dormantSession: null,
      memberships: [{ slug: "acme", role: "owner" }],
      cookieOrg: "victim",
    });
    expect(ws.active).toBe("acme");
    expect(ws.options).not.toContain("victim");
  });

  // Guard (green-before by design): an anonymous viewer, or one with no org, collapses to public.
  it("collapses an anonymous / org-less viewer to public, whatever the cookie says", () => {
    expect(resolveWorkspace({ dormantSession: null, memberships: [], cookieOrg: "acme" })).toEqual({
      options: ["public"],
      active: "public",
    });
  });

  // Guard (green-before by design): dormant-stack parity with orgOptionsForSession/getActiveOrg.
  it("keeps parity with the dormant session: installations keep their casing and the cookie matches case-insensitively", () => {
    expect(
      resolveWorkspace({
        dormantSession: { installations: [{ id: 1, login: "Acme" }] },
        memberships: [],
        cookieOrg: "acme",
      }),
    ).toEqual({ options: ["Acme", "public"], active: "Acme" });
  });

  it("dedupes an org present in both stacks case-insensitively, keeping the first casing seen", () => {
    const ws = resolveWorkspace({
      dormantSession: { installations: [{ id: 1, login: "Acme" }] },
      memberships: [
        { slug: "acme", role: "owner" },
        { slug: "beta", role: "member" },
      ],
      cookieOrg: null,
    });
    expect(ws.options).toEqual(["Acme", "beta", "public"]);
    // No cookie: the primary membership wins over the first installation, in canonical option casing.
    expect(ws.active).toBe("Acme");
  });

  it("offers public exactly once and last, even when a membership row names it", () => {
    const ws = resolveWorkspace({
      dormantSession: null,
      memberships: [
        { slug: "public", role: "viewer" },
        { slug: "acme", role: "member" },
      ],
      cookieOrg: "PUBLIC",
    });
    expect(ws.options).toEqual(["acme", "public"]);
    expect(ws.active).toBe("public");
  });

  it("the active org is ALWAYS one of the options, for any cookie", () => {
    const memberships = [{ slug: "acme", role: "owner" as const }];
    for (const cookieOrg of [null, "", "  ", "acme", "ACME", "victim", "public", "../evil"]) {
      const ws = resolveWorkspace({ dormantSession: null, memberships, cookieOrg });
      expect(ws.options).toContain(ws.active);
    }
  });
});
