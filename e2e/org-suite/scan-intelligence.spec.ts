import { test, expect } from "@playwright/test";
import { DIMENSIONS } from "../../src/lib/maturity/model";

// The core promise: a scan is INTELLIGENT — it yields enough structural action points to enable
// AI-driven development, framed as exploration (inputs, not directives). Exercises the LIVE LLM.
const REPO = "vercel/shop"; // a real Vercel repo, small enough to scan live

test.describe("Scan intelligence — live LLM action points", () => {
  test("a live scan yields structural, exploration-framed action points", async ({ request }) => {
    // 280s, not 200s: a measured claude-opus-5 assessment of a comparable repo took 177s wall-clock
    // (163s inside the model). The old budget left no headroom for a slower repo, and a timeout there
    // reads as "the scan is broken" rather than "the model took longer today".
    const res = await request.post("/api/scan", { data: { url: REPO, mock: false }, timeout: 280_000 });
    expect(res.ok()).toBeTruthy();
    const report = await res.json();

    // A full, intelligent assessment: every dimension in the rubric + a posture + a level + a headline.
    //
    // Asserted against the RUBRIC rather than a literal: this spec said 8 long after D9 (Supply Chain
    // & Security) joined the model, so a live scan returning a correct 9 dimensions failed as though
    // the engine were broken. A hard-coded count turns every future rubric change into a false alarm,
    // and the thing worth pinning is "the model scored all of them", not the number itself.
    expect(report.dimensions).toHaveLength(DIMENSIONS.length);
    expect(report.level?.id).toMatch(/^L[1-5]$/);
    expect(report.posture?.id).toBeTruthy();
    expect((report.headline ?? "").length).toBeGreaterThan(10);

    // Enough action points for structural change — and framed as EXPLORATION (questions), not orders.
    expect(report.roadmap.length).toBeGreaterThanOrEqual(3);
    const withQuestions = (report.roadmap as Array<{ explore?: string[] }>).filter(
      (r) => Array.isArray(r.explore) && r.explore.some((q) => q.includes("?")),
    );
    expect(withQuestions.length).toBeGreaterThanOrEqual(1);

    // The action points address the structural enablers of AI-driven dev (guidance / agents / harness).
    const dims = (report.roadmap as Array<{ dimension: string }>).map((r) => r.dimension);
    expect(dims.some((d) => ["D1", "D4", "D8"].includes(d))).toBeTruthy();
  });

  test("the report page renders the standing and the gaps as explorations", async ({ page }) => {
    await page.goto(`/report?repo=${encodeURIComponent(REPO)}`);
    // Wait out the live scan composing the report. "Trust ladder" and "Gaps to explore" were this
    // page's headings when the report was first built; it has since been restructured and they no
    // longer exist, so the spec was asserting on a UI two refactors old. The equivalents that carry
    // the same meaning today are the score waterfall (where the standing comes from) and "Risks &
    // gaps" (what to do about it).
    await expect(page.getByRole("heading", { name: "Score waterfall" })).toBeVisible({ timeout: 280_000 });
    await expect(page.getByRole("heading", { name: /Risks & gaps/ })).toBeVisible();
    // The "Explore" kicker used to be asserted here. It cannot be, against a LIVE provider: ExploreList
    // renders nothing when a recommendation carries no `explore` items, and whether the model emits any
    // is its call, not the page's — this very repo's live report has none. Asserting it made a passing
    // run depend on optional model output, so the suite would go red on a perfectly good scan.
    // The non-directive framing is pinned deterministically instead, in roadmapPieces.test.tsx.
  });
});
