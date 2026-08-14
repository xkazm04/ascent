import { test, expect } from "@playwright/test";

// Overview = the fleet's repos×time view. The org overview was restructured (src/app/org/[slug]/page.tsx):
// it now renders the RepoCategoryRollup ("Fleet" — repos grouped by Type/Stack/Level) and the
// RepoDimensionHeatmap. The old rec-rollup + goals/movers/"gaps to explore" narrative moved to the
// Briefing (/executive). This suite asserts today's real surfaces; the moved narrative is checked
// against /executive in the second describe below.
test.describe("Org Overview — fleet standing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel");
  });

  test("persistent org header + section nav", async ({ page }) => {
    // The org name is a header label (a span, not an <h1>) beside the fleet maturity chip.
    await expect(page.getByText("vercel", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/L[1-5] · \d+/).first()).toBeVisible(); // maturity chip: level · index score
    // The rail nav (SectionRailNav) exposes the ACTIVE section's pages as links. W1a regrouped the
    // rail around the transition journey, so Overview's section is "Standing" — Briefing moved to
    // "Bought" and is reached from the rail button, not from this panel.
    const nav = page.getByRole("navigation", { name: "Organization sections" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Repositories", exact: true })).toBeVisible();
    // The five journey sections are the rail's first level.
    for (const section of ["Standing", "Chosen", "In flight", "Bought", "Admin"]) {
      await expect(nav.getByRole("button", { name: new RegExp(section, "i") }).first()).toBeVisible();
    }
  });

  test("Fleet rollup groups repos and carries real movement", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Fleet" })).toBeVisible();
    // Group-by control (Type / Stack / Level) is how the rollup re-cohorts repos.
    const groupBy = page.getByRole("group", { name: "Group by" });
    await expect(groupBy).toBeVisible();
    for (const m of ["Type", "Stack", "Level"]) {
      await expect(groupBy.getByRole("button", { name: m, exact: true })).toBeVisible();
    }
    // The fleet masthead surfaces real week-over-week movement (▲ improving) — the movers signal that
    // used to live in a separate "Top gainers" panel now reads inline here.
    await expect(page.getByText("▲").first()).toBeVisible();
    // At least one repo row links to its report permalink (owner/name accessible name).
    await expect(page.getByRole("link", { name: /vercel\/\S/ }).first()).toBeVisible();
  });

  test("Dimension heatmap exposes per-dimension standing", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dimension heatmap" })).toBeVisible();
    // Each of the 9 dimensions is a sortable column header button.
    await expect(page.getByRole("button", { name: "D1", exact: true }).first()).toBeVisible();
  });
});

// The rec-rollup + direction narrative (maturity/adoption/rigor headline, goals, highest-leverage
// moves) moved OFF the overview and onto the Briefing (/executive). These assertions are relocated
// here against their real surface. NB: the highest-leverage "moves" list (OrgLeverageMoves) copy is
// being rewritten in parallel, so we assert the briefing's STABLE structural headings — never the
// moves' wording. The old "Where the gaps live / Common organization gaps / Repo-specific gaps /
// Standing / Top gainers" assertions are intentionally dropped: no current overview surface renders
// them (they live on other tabs — plan, governance — outside this suite's scope).
test.describe("Org Briefing — direction & standing (moved from Overview)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/org/vercel/executive");
  });

  test("headline tiles carry real maturity, adoption & rigor", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Executive briefing" })).toBeVisible();
    // Tile labels (real numbers rendered beside them). "Repos scanned" was NOT part of this headline
    // set — the briefing pairs maturity/adoption/rigor with a corpus percentile instead.
    for (const label of ["Org maturity", "AI Adoption", "Engineering Rigor", "Corpus percentile"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("gives the org direction — strengths, weakest dimensions & goals", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Strengths" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weakest dimensions" })).toBeVisible();
    // Goals section (relocated from the old overview goal-direction test) — heading always renders;
    // beneath it, either goal rows or the "No goals set" empty state.
    await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();
  });
});
