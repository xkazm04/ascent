// The public-preview funnel used to dead-end at its LAST click: POST /api/org/import runs
// requireOrgAccess before reading `mock`, so an anonymous caller on a Supabase-configured deploy gets
// a 401 whose raw string ("Sign in to manage this organization.") was echoed straight into the wizard
// with no sign-in affordance. The classifier is what turns those refusals into a recovery.

import { describe, it, expect } from "vitest";
import { classifyScanFailure, gateAnnouncement, isPersonalRefusal } from "./scanGate";

describe("classifyScanFailure", () => {
  it("maps a 401 (anonymous on a Supabase-configured deploy) to the sign-in gate", () => {
    const gate = classifyScanFailure(
      { status: 401, message: "Sign in to manage this organization." },
      "vercel",
    );
    expect(gate).toEqual({ kind: "signin", org: "vercel" });
  });

  it("maps a 403 (signed in, not a member) to the no-access gate", () => {
    const gate = classifyScanFailure(
      { status: 403, message: "You don't have access to this organization." },
      "netflix",
    );
    expect(gate).toEqual({ kind: "no-access", org: "netflix" });
  });

  it("splits requireFleetOrg's 403 (a PERSONAL workspace) off from the membership 403", () => {
    // The route runs requireOrgAccess then requireFleetOrg, so both answer 403 — only the message
    // distinguishes them, and only the fleet one quotes an internal API route at the user.
    expect(
      classifyScanFailure(
        {
          status: 403,
          message:
            "This is a fleet operation. Personal workspaces track repos via /api/me/watch and rescan through the public report flow.",
        },
        "dana",
      ),
    ).toEqual({ kind: "personal", org: "dana" });
    expect(isPersonalRefusal("You don't have access to this organization.")).toBe(false);
    expect(isPersonalRefusal(undefined)).toBe(false);
  });

  it("returns null for a genuine failure so the server's diagnostic is NOT swallowed", () => {
    expect(classifyScanFailure({ status: 500, message: "Import failed (500)." }, "acme")).toBeNull();
    expect(classifyScanFailure({ status: 402, message: "Out of credits." }, "acme")).toBeNull();
    // A transport-level failure has no status at all — still a genuine error, not a gate.
    expect(classifyScanFailure({ message: "Failed to fetch" }, "acme")).toBeNull();
  });

  it("announces each gate in human words (the step's live-region title)", () => {
    expect(gateAnnouncement({ kind: "signin", org: "vercel" })).toMatch(/sign in/i);
    expect(gateAnnouncement({ kind: "no-access", org: "netflix" })).toContain("netflix");
  });
});
