// MOONSHOT #1 — the webhook normalizers. The load-bearing assertion in this file is a NEGATIVE one:
// nothing here ever produces a control STATE. A delivery names the actor and the moment; only a
// re-read from GitHub names the state.

import { describe, expect, it } from "vitest";
import { GOVERNANCE_EVENTS, normalizeGovernanceEvent, readReviewApproval } from "@/lib/github/governance-events";
import { CONTROLS } from "@/lib/controls/catalog";

const catalogued = new Set(CONTROLS.map((c) => c.id));

const brandProtection = {
  action: "edited",
  sender: { login: "octocat" },
  rule: { name: "main", updated_at: "2026-08-20T10:00:00Z" },
  repository: { full_name: "acme/api" },
};

describe("normalizeGovernanceEvent", () => {
  it("names the actor, the moment and the controls the event bears on", () => {
    const a = normalizeGovernanceEvent("branch_protection_rule", brandProtection)!;
    expect(a.actorLogin).toBe("octocat");
    expect(a.occurredAt).toBe("2026-08-20T10:00:00.000Z");
    expect(a.controlIds).toContain("branch-protection");
    expect(a.evidence).toMatchObject({ event: "branch_protection_rule", action: "edited", rule: "main" });
  });

  // The point of the module.
  it("returns NO state and NO value for any event — a payload is not an observation", () => {
    for (const event of GOVERNANCE_EVENTS) {
      const a = normalizeGovernanceEvent(event, brandProtection);
      expect(JSON.stringify(a)).not.toContain('"state"');
      expect(JSON.stringify(a)).not.toContain('"value"');
    }
  });

  it("every control id it emits exists in the catalogue", () => {
    for (const event of GOVERNANCE_EVENTS) {
      for (const id of normalizeGovernanceEvent(event, brandProtection)?.controlIds ?? []) {
        expect(catalogued.has(id), `${event} emitted an uncatalogued control ${id}`).toBe(true);
      }
    }
  });

  it("a ruleset also bears on the ruleset count", () => {
    const a = normalizeGovernanceEvent("repository_ruleset", {
      action: "created",
      sender: { login: "octocat" },
      repository_ruleset: { name: "prod", updated_at: "2026-08-20T10:00:00Z" },
    })!;
    expect(a.controlIds).toContain("ruleset-count");
    expect(a.evidence.rule).toBe("prod");
  });

  it("a repository event moves the DESCRIPTORS, not the protection bars", () => {
    const a = normalizeGovernanceEvent("repository", { action: "archived", sender: { login: "octocat" } })!;
    expect(a.controlIds).toEqual(["repo-visibility", "repo-archived", "repo-present"]);
    expect(a.controlIds).not.toContain("branch-protection");
  });

  it("member/team are identity-graph events and map to NO control (that is deck item #21)", () => {
    expect(normalizeGovernanceEvent("member", brandProtection)).toBeNull();
    expect(normalizeGovernanceEvent("team", brandProtection)).toBeNull();
    expect(GOVERNANCE_EVENTS).not.toContain("member");
  });

  it("an unknown event and an unparseable payload both yield null, never a throw", () => {
    expect(normalizeGovernanceEvent("push", brandProtection)).toBeNull();
    expect(normalizeGovernanceEvent("code_scanning_alert", brandProtection)).toBeNull();
    expect(normalizeGovernanceEvent("branch_protection_rule", null)).toBeNull();
    expect(normalizeGovernanceEvent("branch_protection_rule", "not-an-object")).toBeNull();
  });

  it("a missing actor is null, never a placeholder", () => {
    expect(normalizeGovernanceEvent("branch_protection_rule", { action: "edited" })?.actorLogin).toBeNull();
  });

  it("an unparseable timestamp is DROPPED rather than passed through onto an evidence row", () => {
    const a = normalizeGovernanceEvent("branch_protection_rule", {
      sender: { login: "octocat" },
      rule: { updated_at: "yesterday-ish" },
    })!;
    expect(a.occurredAt).toBeNull();
  });
});

describe("readReviewApproval", () => {
  const approved = {
    action: "submitted",
    review: { state: "approved", user: { login: "lead-one" }, submitted_at: "2026-08-20T11:00:00Z" },
    pull_request: { number: 42 },
  };

  it("reads an approving review", () => {
    expect(readReviewApproval(approved)).toEqual({
      prNumber: 42,
      approverLogin: "lead-one",
      approvedAt: "2026-08-20T11:00:00.000Z",
    });
  });

  it("accepts GitHub's upper-cased state too", () => {
    expect(readReviewApproval({ ...approved, review: { ...approved.review, state: "APPROVED" } })?.prNumber).toBe(42);
  });

  it("ignores a comment or a change request — reviewed is not approved", () => {
    expect(readReviewApproval({ ...approved, review: { ...approved.review, state: "commented" } })).toBeNull();
    expect(readReviewApproval({ ...approved, review: { ...approved.review, state: "changes_requested" } })).toBeNull();
  });

  // A dismissal we happen to see and one we happen to miss must not produce different stored
  // evidence; the next scan re-reads the whole review set and is authoritative for withdrawal.
  it("ignores a DISMISSED review rather than treating it as a negative signal", () => {
    expect(readReviewApproval({ ...approved, action: "dismissed" })).toBeNull();
  });

  it("a deleted reviewer account is null, never a placeholder", () => {
    expect(readReviewApproval({ ...approved, review: { ...approved.review, user: {} } })?.approverLogin).toBeNull();
  });

  it("a payload with no PR number yields null", () => {
    expect(readReviewApproval({ ...approved, pull_request: {} })).toBeNull();
    expect(readReviewApproval(null)).toBeNull();
  });
});
