// The STANDING DECISIONS block — the read side of the Shared Org Memory loop.
//
// Two properties matter more than the block's wording:
//   1. It lives in the per-repo USER message and NEVER in SYSTEM. SYSTEM is byte-identical across every
//      scan so providers can cache the prefix; a per-repo block there would shatter that cache on every
//      single scan, silently multiplying cost.
//   2. A repo with no decisions produces a prompt byte-identical to the pre-feature one. Otherwise the
//      feature quietly re-calibrates every existing scan.

import { describe, expect, it } from "vitest";
import { buildAssessmentPrompt } from "./prompt";
import type { LlmScoreInput } from "@/lib/llm/provider";
import type { DecisionNote } from "@/lib/db/org-decisions";

function input(overrides: Partial<LlmScoreInput> = {}): LlmScoreInput {
  return {
    repo: {
      owner: "acme",
      name: "rocket",
      url: "https://github.com/acme/rocket",
      stars: 10,
      forks: 2,
      defaultBranch: "main",
    },
    signals: [{ id: "D1", signalScore: 50, signals: [] }],
    files: [],
    commitSample: [],
    archetype: "team",
    governance: null,
    ...overrides,
  };
}

const decisions: DecisionNote[] = [
  {
    module: "teams",
    title: "acme/rocket has no owning team",
    status: "dismissed",
    rationale: "Docs-only mirror; ownership lives in the upstream repo.",
  },
  {
    module: "security",
    title: "Branch protection — acme/rocket",
    status: "accepted",
    rationale: "Scheduled for Q3 platform hardening.",
  },
];

describe("STANDING DECISIONS block", () => {
  it("never touches the cacheable SYSTEM prefix", () => {
    const without = buildAssessmentPrompt(input());
    const with_ = buildAssessmentPrompt(input({ orgDecisions: decisions }));
    expect(with_.system).toBe(without.system);
  });

  it("leaves the prompt byte-identical when the org has no decisions", () => {
    const none = buildAssessmentPrompt(input());
    const empty = buildAssessmentPrompt(input({ orgDecisions: [] }));
    expect(empty.user).toBe(none.user);
    expect(none.user).not.toContain("STANDING DECISIONS");
  });

  it("renders each decision with its module, status and reason", () => {
    const { user } = buildAssessmentPrompt(input({ orgDecisions: decisions }));
    expect(user).toContain("STANDING DECISIONS");
    expect(user).toContain("[teams · dismissed] acme/rocket has no owning team");
    expect(user).toContain("reason: Docs-only mirror; ownership lives in the upstream repo.");
    expect(user).toContain("[security · accepted] Branch protection — acme/rocket");
  });

  it("tells the model a dismissal is context, not a reason to inflate the score", () => {
    const { user } = buildAssessmentPrompt(input({ orgDecisions: decisions }));
    expect(user).toContain("not as a reason to raise the score");
    expect(user).toContain("do NOT re-raise a dismissed finding");
  });

  it("bounds a runaway rationale so it can't crowd out the repo's own evidence", () => {
    const long: DecisionNote[] = [{ module: "teams", title: "t", status: "dismissed", rationale: "x".repeat(5000) }];
    const { user } = buildAssessmentPrompt(input({ orgDecisions: long }));
    expect(user).toContain("…[truncated]");
    expect(user.length).toBeLessThan(3000);
  });
});
