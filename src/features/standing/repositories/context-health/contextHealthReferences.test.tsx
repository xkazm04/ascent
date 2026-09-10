import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrgRepoRow } from "@/lib/db/org-rollup";
import { buildContextRows, fleetContextSummary } from "./contextHealthModel";
import { ContextHalfLife } from "./ContextHalfLife";

function rows(total?: number) {
  return buildContextRows([{
    name: "app", fullName: "acme/app", latest: { overall: 70 }, activity: null,
    contextHealth: {
      version: "1", present: true, score: 70,
      files: [{ path: "CLAUDE.md", sectionsScore: 80 }],
      freshness: { score: 90, ageDays: 1, commitsSinceEdit: 1, approximate: true },
      quality: { score: 80, signals: [] },
      drift: { score: 0, refsTotal: 30, deadRefsTotal: total, deadRefs: Array.from({ length: 12 }, (_, i) => `missing-${i}.md`) },
    },
  } as OrgRepoRow]);
}

describe("context-health reference totals in fleet copy", () => {
  it("carries the exact count beyond the example cap through row and fleet summaries", () => {
    const data = rows(30);
    expect(data[0]!.verdict).toBe("30 unresolved file references");
    expect(fleetContextSummary(data)).toMatchObject({ deadRefsTotal: 30, deadRefsLowerBound: false });
  });

  it("discloses a legacy sample as a lower bound in the rendered tile", () => {
    const data = rows();
    expect(data[0]!.verdict).toBe("at least 12 unresolved file references");
    expect(fleetContextSummary(data)).toMatchObject({ deadRefsTotal: 12, deadRefsLowerBound: true });
    expect(renderToStaticMarkup(<ContextHalfLife slug="acme" rows={data} />)).toContain("at least 12");
  });

  it("keeps a mixed fleet total qualified when one repo has only legacy examples", () => {
    const summary = fleetContextSummary([...rows(30), ...rows()]);
    expect(summary).toMatchObject({ deadRefsTotal: 42, deadRefRepos: 2, deadRefsLowerBound: true });
  });
});
