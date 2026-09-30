import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrgRepoRow } from "@/lib/db/org-rollup";
import { buildContextRows } from "./contextHealthModel";
import { ContextHalfLifeV2 } from "./ContextHalfLife.v2";

function measured(total?: number): OrgRepoRow {
  return {
    name: "app",
    fullName: "acme/app",
    latest: { overall: 70 },
    activity: null,
    contextHealth: {
      version: "1",
      present: true,
      score: 70,
      files: [{ path: "CLAUDE.md", sectionsScore: 80 }],
      freshness: { score: 90, ageDays: 1, commitsSinceEdit: 1, approximate: true },
      quality: { score: 80, signals: [] },
      drift: { score: 0, refsTotal: 30, deadRefsTotal: total, deadRefs: Array.from({ length: 12 }, (_, i) => `missing-${i}.md`) },
    },
  } as OrgRepoRow;
}

describe("ContextHalfLifeV2", () => {
  it("keeps a legacy dead-reference sample qualified as a lower bound", () => {
    const html = renderToStaticMarkup(<ContextHalfLifeV2 slug="acme" rows={buildContextRows([measured()])} />);
    expect(html).toContain("at least 12");
    expect(html).toContain("90%");
    expect(html).toContain('data-kit="stat-strip"');
    expect(html).toContain('data-kit="cell-mark"');
  });

  it("shows an unassessed repo as not assessed, not as zero potency", () => {
    const rows = buildContextRows([{ name: "old", fullName: "acme/old", latest: { overall: 10 }, activity: null, contextHealth: null } as OrgRepoRow]);
    const html = renderToStaticMarkup(<ContextHalfLifeV2 slug="acme" rows={rows} />);
    expect(html).toContain("Not assessed by this scan");
    expect(html).toContain("1 not assessed");
    expect(html).toContain('data-kit="void-mark"');
    expect(html).not.toContain(">0%<");
  });
});
