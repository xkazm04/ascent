// Pins the Overview's scoped-empty gate. The async fleet panel cannot render in the unit suite; the
// predicate and the copy are what decide "this view matched nothing" vs a fake 0 fleet, so they live
// here. A source scan then proves the panel takes that branch, and that OverviewTab still streams
// Fix-first behind its loading gap (a pending punch-list is not "no priorities") and the trajectory
// card still refuses a thin fit rather than drawing a 0 slope.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isOverviewScopedEmpty, OVERVIEW_SCOPED_EMPTY } from "./overviewEmpty";

const dir = join(process.cwd(), "src/features/standing/overview");
const read = (name: string) => readFileSync(join(dir, name), "utf8");

describe("isOverviewScopedEmpty", () => {
  it("treats a missing rollup as empty", () => {
    expect(isOverviewScopedEmpty(null)).toBe(true);
  });

  it("treats a rollup that matched zero repos as the same empty — not a 0 fleet", () => {
    expect(isOverviewScopedEmpty({ repos: [] })).toBe(true);
  });

  it("lets a rollup that matched any repo through to the ledger", () => {
    expect(isOverviewScopedEmpty({ repos: [{ fullName: "acme/api" }] })).toBe(false);
  });
});

describe("OVERVIEW_SCOPED_EMPTY — the existing copy, not a fabricated 0", () => {
  it("keeps the scoped-miss wording (period / segment), never a 0/0 fleet claim", () => {
    expect(OVERVIEW_SCOPED_EMPTY.title).toBe("No data for this view");
    expect(OVERVIEW_SCOPED_EMPTY.body).toMatch(/period or segment/);
    expect(OVERVIEW_SCOPED_EMPTY.cta).toBe("View repositories");
    expect(`${OVERVIEW_SCOPED_EMPTY.title} ${OVERVIEW_SCOPED_EMPTY.body}`).not.toMatch(/\b0\s*\/\s*0\b/);
    expect(OVERVIEW_SCOPED_EMPTY.body).not.toMatch(/\b0 scored\b/);
  });
});

describe("OverviewFleetPanel — the gate is the helper, before the ledger", () => {
  const panel = read("OverviewFleetPanel.tsx");

  it("branches on isOverviewScopedEmpty, not only a null rollup", () => {
    expect(panel).toMatch(/isOverviewScopedEmpty\(rollup\)/);
    expect(panel).not.toMatch(/if\s*\(\s*!rollup\s*\)/);
  });

  it("renders the existing scoped-empty copy through OrgEmpty, then the ledger only after", () => {
    expect(panel).toMatch(/OVERVIEW_SCOPED_EMPTY/);
    expect(panel).toMatch(/<OrgEmpty/);
    const emptyAt = panel.indexOf("isOverviewScopedEmpty(rollup)");
    const ledgerAt = panel.indexOf("<OverviewLedger");
    expect(emptyAt).toBeGreaterThan(-1);
    expect(ledgerAt).toBeGreaterThan(emptyAt);
  });
});

describe("OverviewTab — Fix-first loading gap and fleet panel stay independent", () => {
  const tab = read("OverviewTab.tsx");

  it("still reserves OverviewFixFirstGap while the punch-list streams", () => {
    expect(tab).toMatch(/<Suspense fallback=\{<OverviewFixFirstGap \/>\}>\s*<OverviewFixFirstPanel/);
  });

  it("still mounts OverviewFleetPanel in its own boundary (empty lives there, not here)", () => {
    expect(tab).toMatch(/<OverviewFleetPanel/);
    expect(tab).not.toMatch(/isOverviewScopedEmpty/);
  });
});

describe("OverviewTrajectoryCard — thin-fit refusal is untouched", () => {
  const card = read("OverviewTrajectoryCard.tsx");

  it("still gates on composeTrajectory and prints the insufficiency, never a 0 slope", () => {
    expect(card).toMatch(/composeTrajectory\(forecast\)/);
    expect(card).toMatch(/read\.insufficiency/);
    expect(card).not.toMatch(/slope:\s*0/);
  });
});
