import { test, expect } from "@playwright/test";

// The core promise: a scan is INTELLIGENT — it yields enough structural action points to enable
// AI-driven development, framed as exploration (inputs, not directives). Exercises the LIVE LLM.
const REPO = "vercel/shop"; // a real Vercel repo, small enough to scan live

test.describe("Scan intelligence — live LLM action points", () => {
  test("a live scan yields structural, exploration-framed action points", async ({ request }) => {
    const res = await request.post("/api/scan", { data: { url: REPO, mock: false }, timeout: 200_000 });
    expect(res.ok()).toBeTruthy();
    const report = await res.json();

    // A full, intelligent assessment: all 8 dimensions + a posture + a maturity level + a headline.
    expect(report.dimensions).toHaveLength(8);
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

  test("the report page renders the trust ladder + exploration cards", async ({ page }) => {
    await page.goto(`/report?repo=${encodeURIComponent(REPO)}`);
    // wait out the live scan composing the report
    await expect(page.getByRole("heading", { name: "Trust ladder" })).toBeVisible({ timeout: 200_000 });
    await expect(page.getByRole("heading", { name: /Gaps to explore/ })).toBeVisible();
    // exploration cards expose open questions ("Explore"), not commands
    await expect(page.getByText("Explore", { exact: true }).first()).toBeVisible();
  });
});
