// G7-25. The promote mapping must produce a draft the SERVER will store verbatim — createPlaybook
// silently one-lines the title, truncates the summary at 1000, and keeps only the first 20 steps at
// 300 chars each. A draft that violates those bounds looks fine in the form and then loses content on
// save, which is the exact failure a "promote, don't re-type" hand-off exists to avoid.

import { describe, it, expect } from "vitest";
import type { OrgPractice } from "@/lib/db";
import { practiceToPlaybookDraft } from "./promotePractice";

function practice(over: Partial<OrgPractice> = {}): OrgPractice {
  return {
    id: "ci-gates",
    label: "CI gates on every PR",
    dimId: "D2",
    what: "Every pull request runs the test + lint suite before merge.",
    starter: ["Add a CI workflow", "Require the check on the default branch"],
    total: 10,
    strongCount: 6,
    exemplar: { name: "web", fullName: "acme/web", score: 88 },
    gapRepos: ["api"],
    gapRepoRefs: [{ name: "api", fullName: "acme/api" }],
    ...over,
  };
}

describe("practiceToPlaybookDraft", () => {
  it("carries the label, dimension and starter steps across unchanged", () => {
    const d = practiceToPlaybookDraft(practice());
    expect(d.title).toBe("CI gates on every PR");
    expect(d.dimId).toBe("D2");
    expect(d.steps).toEqual(["Add a CI workflow", "Require the check on the default branch"]);
  });

  it("names the exemplar in the summary — the one fact the author form can't recover", () => {
    expect(practiceToPlaybookDraft(practice()).summary).toBe(
      "Every pull request runs the test + lint suite before merge. Proven in acme/web (88/100).",
    );
  });

  it("omits the exemplar clause entirely when the practice is greenfield", () => {
    const d = practiceToPlaybookDraft(practice({ exemplar: null }));
    expect(d.summary).toBe("Every pull request runs the test + lint suite before merge.");
    expect(d.summary).not.toMatch(/Proven in/);
  });

  it("respects createPlaybook's bounds: single-line title ≤200, summary ≤1000, ≤20 steps ≤300 chars", () => {
    const d = practiceToPlaybookDraft(
      practice({
        label: `Multi\nline ${"T".repeat(300)}`,
        what: "W".repeat(2000),
        exemplar: null,
        starter: [...Array.from({ length: 25 }, (_, i) => `step ${i}`), "S".repeat(400)],
      }),
    );
    expect(d.title).toHaveLength(200);
    expect(d.title).not.toMatch(/\n/);
    expect(d.title.startsWith("Multi line ")).toBe(true);
    expect(d.summary).toHaveLength(1000);
    expect(d.steps).toHaveLength(20);
    expect(d.steps.every((s) => s.length <= 300)).toBe(true);
  });

  it("drops blank starter lines and one-lines the rest (each renders as one '- [ ]' checkbox)", () => {
    const d = practiceToPlaybookDraft(practice({ starter: ["  ", "a\n  b", ""] }));
    expect(d.steps).toEqual(["a b"]);
  });
});
