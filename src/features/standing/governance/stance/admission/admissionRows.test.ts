// moonshot #8 — the admission column's pure view layer. The invariants are all about not letting a
// MEASUREMENT read as a DECISION, which is the confusion the whole table exists to end.

import { describe, expect, it } from "vitest";
import { admissionSummary, toAdmissionViews } from "./admissionRows";
import type { RepoAdmissionRow } from "@/lib/org/admission";

const row = (over: Partial<RepoAdmissionRow> = {}): RepoAdmissionRow => ({
  id: "a",
  repoFullName: "acme/billing",
  stanceVersion: 4,
  derivedTier: "T1",
  grantedTier: "T1",
  mode: "assisted-only",
  decidedBy: null,
  decidedAt: null,
  rationale: "",
  rulesetId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

describe("toAdmissionViews", () => {
  it("marks a seeded row as UNDECIDED and a decided one as decided", () => {
    expect(toAdmissionViews([row()], 4)[0]).toMatchObject({ decided: false, decidedBy: null });
    expect(toAdmissionViews([row({ decidedBy: "octocat" })], 4)[0]).toMatchObject({ decided: true, decidedBy: "octocat" });
  });

  // The honest null, enforced at the view layer as well as in the compiler: rendering `grantedTier`
  // for a repo with no passport would show a grade nobody measured.
  it("renders no tier at all when none was assessed, whatever the row's grant says", () => {
    expect(toAdmissionViews([row({ derivedTier: null, grantedTier: "T3" })], 4)[0]!.tier).toBeNull();
  });

  it("surfaces an override only when the grant actually departs from the measurement", () => {
    expect(toAdmissionViews([row({ derivedTier: "T1", grantedTier: "T3" })], 4)[0]!.overridesDerived).toBe("T1");
    expect(toAdmissionViews([row({ derivedTier: "T1", grantedTier: "T1" })], 4)[0]!.overridesDerived).toBeNull();
    expect(toAdmissionViews([row({ derivedTier: null })], 4)[0]!.overridesDerived).toBeNull();
  });

  it("computes staleness against the ACTIVE version, and never guesses without one", () => {
    expect(toAdmissionViews([row({ stanceVersion: 3 })], 5)[0]!.stale).toBe(true);
    expect(toAdmissionViews([row({ stanceVersion: 5 })], 5)[0]!.stale).toBe(false);
    // No published stance: "behind" has nothing to be behind.
    expect(toAdmissionViews([row({ stanceVersion: 3 })], null)[0]!.stale).toBe(false);
  });

  // A repo with no passport and no decision has NO admission row at all — the gate applies no bar to
  // it — so the view must be able to say that instead of borrowing the middle rung's label.
  it("marks a repo with neither a measurement nor a decision as UNASSESSED", () => {
    expect(toAdmissionViews([row({ derivedTier: null })], 4)[0]!.unassessed).toBe(true);
    // A decision on an unassessed repo IS enforced (mode floors apply without a tier), so it is not
    // unassessed in this sense — somebody decided.
    expect(toAdmissionViews([row({ derivedTier: null, decidedBy: "octocat" })], 4)[0]!.unassessed).toBe(false);
    expect(toAdmissionViews([row()], 4)[0]!.unassessed).toBe(false);
  });

  it("orders by full name so the list is stable across reloads", () => {
    const views = toAdmissionViews([row({ repoFullName: "acme/zeta" }), row({ repoFullName: "acme/alpha" })], 4);
    expect(views.map((v) => v.fullName)).toEqual(["acme/alpha", "acme/zeta"]);
  });
});

describe("admissionSummary", () => {
  it("says plainly when nobody has decided — a seeded fleet must not read as a decided one", () => {
    const s = admissionSummary(toAdmissionViews([row(), row({ repoFullName: "acme/api" })], 4));
    expect(s).toContain("2 repositories");
    expect(s).toContain("nobody has decided");
  });

  it("counts the two ends of the ladder", () => {
    const s = admissionSummary(
      toAdmissionViews(
        [
          row({ repoFullName: "acme/a", mode: "blocked", decidedBy: "o" }),
          row({ repoFullName: "acme/b", mode: "agents-allowed", decidedBy: "o" }),
        ],
        4,
      ),
    );
    expect(s).toContain("1 admit agents");
    expect(s).toContain("1 blocked");
    expect(s).not.toContain("nobody has decided");
  });

  // The list is now the org's TRACKED REPOSITORIES, not the decision table, so an empty one means the
  // org tracks nothing — the old sentence described a list that no longer exists and was shown to
  // every org whose repos simply had no rows seeded.
  it("has an honest empty state about repositories, not decisions", () => {
    expect(admissionSummary([])).toContain("tracks no repositories yet");
  });

  // "Nobody has decided" and "there is nothing to decide against yet" are different problems with
  // different fixes, so the summary must not fold one into the other.
  it("counts unassessed repos apart from undecided ones", () => {
    const s = admissionSummary(
      toAdmissionViews([row({ repoFullName: "acme/a" }), row({ repoFullName: "acme/b", derivedTier: null })], 4),
    );
    expect(s).toContain("1 still on the seeded default");
    expect(s).toContain("1 not assessed — no bar applies");
  });
});
