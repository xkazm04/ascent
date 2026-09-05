// Every absence class and every stage is REACHABLE, and the precedence is the registry's
// (`build-fleet-map.mjs` `classifyAbsence`): a subject that is both out of domain and declined is
// out-of-domain, because the ledger row would otherwise mean something the manifest says cannot apply.

import { describe, expect, it } from "vitest";
import { KNOWLEDGE_CELL_STATES } from "@/lib/org/knowledge-shape";
import { classifyAbsence, repoStage, scopeExcludes, type AbsenceRepo } from "./absence";

const subject = { slug: "table", bundle: "software-engineering", category: "ui-surfaces", subcategory: "data-display" };

const repo = (over: Partial<AbsenceRepo> = {}): AbsenceRepo => ({
  hasMap: true,
  domains: ["software-engineering"],
  scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
  directions: [],
  ...over,
});

describe("classifyAbsence", () => {
  it("no-map wins over everything — nothing below can be known without a map", () => {
    expect(classifyAbsence(subject, repo({ hasMap: false, domains: [], directions: [{ subject: "table", bundle: "software-engineering", decision: "declined" }] }))).toBe("no-map");
  });

  it("out-of-domain when the manifest does not declare the subject's bundle", () => {
    expect(classifyAbsence(subject, repo({ domains: ["media-craft"] }))).toBe("out-of-domain");
    // A repo with NO manifest declares no domains, so every subject is out of domain — the
    // registry's rule, and the instruction to write one.
    expect(classifyAbsence(subject, repo({ domains: [] }))).toBe("out-of-domain");
  });

  it("out-of-scope by subject key, category key or subcategory key", () => {
    expect(classifyAbsence(subject, repo({ scope: { outOfScopeCategories: [], outOfScopeSubjects: ["software-engineering/table"] } }))).toBe("out-of-scope");
    expect(classifyAbsence(subject, repo({ scope: { outOfScopeCategories: ["software-engineering/ui-surfaces"], outOfScopeSubjects: [] } }))).toBe("out-of-scope");
    expect(classifyAbsence(subject, repo({ scope: { outOfScopeCategories: ["software-engineering/ui-surfaces/data-display"], outOfScopeSubjects: [] } }))).toBe("out-of-scope");
  });

  it("does not let another bundle's scope key exclude this subject", () => {
    expect(scopeExcludes({ outOfScopeCategories: ["media-craft/ui-surfaces"], outOfScopeSubjects: ["media-craft/table"] }, subject)).toBe(false);
  });

  it("declined / deferred / accepted from the ledger, keyed on bundle + subject", () => {
    const d = (decision: "declined" | "deferred" | "accepted") => repo({ directions: [{ subject: "table", bundle: "software-engineering", decision }] });
    expect(classifyAbsence(subject, d("declined"))).toBe("declined");
    expect(classifyAbsence(subject, d("deferred"))).toBe("deferred");
    expect(classifyAbsence(subject, d("accepted"))).toBe("accepted");
    // A decision for the same slug in ANOTHER bundle is not this subject's decision.
    expect(classifyAbsence(subject, repo({ directions: [{ subject: "table", bundle: "media-craft", decision: "declined" }] }))).toBe("candidate");
  });

  it("scope beats the ledger: a declined subject inside an excluded category is out-of-scope", () => {
    expect(
      classifyAbsence(
        subject,
        repo({
          scope: { outOfScopeCategories: ["software-engineering/ui-surfaces"], outOfScopeSubjects: [] },
          directions: [{ subject: "table", bundle: "software-engineering", decision: "declined" }],
        }),
      ),
    ).toBe("out-of-scope");
  });

  it("candidate is everything else — in domain, in scope, undecided", () => {
    expect(classifyAbsence(subject, repo())).toBe("candidate");
    expect(classifyAbsence({ ...subject, category: null, subcategory: null }, repo())).toBe("candidate");
  });

  it("only ever answers with an absence state from the closed vocabulary", () => {
    const absences = KNOWLEDGE_CELL_STATES.filter((s) => !["conformant", "deviation", "not-applicable", "unknown"].includes(s));
    const seen = new Set([
      classifyAbsence(subject, repo({ hasMap: false })),
      classifyAbsence(subject, repo({ domains: [] })),
      classifyAbsence(subject, repo({ scope: { outOfScopeCategories: [], outOfScopeSubjects: ["software-engineering/table"] } })),
      classifyAbsence(subject, repo({ directions: [{ subject: "table", bundle: "software-engineering", decision: "declined" }] })),
      classifyAbsence(subject, repo({ directions: [{ subject: "table", bundle: "software-engineering", decision: "deferred" }] })),
      classifyAbsence(subject, repo({ directions: [{ subject: "table", bundle: "software-engineering", decision: "accepted" }] })),
      classifyAbsence(subject, repo()),
    ]);
    // Every one of the seven absence states is reachable, and nothing outside them is produced.
    expect([...seen].sort()).toEqual([...absences].sort());
  });
});

describe("repoStage", () => {
  it("populate without a context map — even when a stale map exists", () => {
    expect(repoStage({ hasContextMap: false, hasMap: false, pairsUnknownOrStale: 0 })).toBe("populate");
    expect(repoStage({ hasContextMap: false, hasMap: true, pairsUnknownOrStale: 0 })).toBe("populate");
  });
  it("map when contexts exist but the join has not been built", () => {
    expect(repoStage({ hasContextMap: true, hasMap: false, pairsUnknownOrStale: 0 })).toBe("map");
  });
  it("conform while any pair is unknown or stale", () => {
    expect(repoStage({ hasContextMap: true, hasMap: true, pairsUnknownOrStale: 1 })).toBe("conform");
  });
  it("current only when every pair is judged against today's digest", () => {
    expect(repoStage({ hasContextMap: true, hasMap: true, pairsUnknownOrStale: 0 })).toBe("current");
  });
});
