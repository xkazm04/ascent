// The /about transition intro used to sell "goals and forecast ETAs so the climb stays on pace" as
// if the visitor set them here. The Plan tab that hosted that UI retired 2026-08-17; goals are
// read-only and etaDays prints on the Briefing PDF. This pins the intro clauses, not the comments
// that explain the retirement (a matcher over raw text would read the comment as the copy).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function introTexts(src: string): string[] {
  const body = stripComments(src);
  return [...body.matchAll(/\bintro=\{`([\s\S]*?)`\}/g), ...body.matchAll(/\bintro="([^"]*)"/g)].map(
    (m) => m[1]!,
  );
}

function introClauses(src: string): string[] {
  return introTexts(src)
    .flatMap((t) => t.split(/[.;]/))
    .flatMap((s) => s.split(/,\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when a clause names goals and forecast ETAs as climb controls the visitor operates. */
function namesGoalsAndForecastEtasAsClimbControls(clause: string): boolean {
  const c = clause.toLowerCase();
  if (!/\bgoals?\b/.test(c)) return false;
  if (!(/forecast/.test(c) && /\beta/.test(c))) return false;
  // Attribution to the Briefing PDF is allowed: not a control on this pane.
  if (/briefing pdf/.test(c)) return false;
  return /\bclimb\b/.test(c) || /\bon pace\b/.test(c) || /settable/.test(c) || /you set/.test(c);
}

const SRC = readFileSync(resolve(process.cwd(), "src/components/about/AboutTransition.tsx"), "utf8");

describe("AboutTransition intro does not sell settable goals or forecast ETAs", () => {
  it("still has an intro (a matcher that stopped matching must not pass)", () => {
    expect(introTexts(SRC).length).toBeGreaterThan(0);
    expect(introClauses(SRC).length).toBeGreaterThan(0);
  });

  it("keeps the LEVELS-derived ladder claim the staircase already draws", () => {
    expect(introTexts(SRC).join(" ")).toMatch(/\$\{LEVELS\.length\}-level ladder/);
  });

  it("has 0 intro clauses that name goals and forecast ETAs as climb controls", () => {
    const offenders = introClauses(SRC).filter(namesGoalsAndForecastEtasAsClimbControls);
    expect(offenders).toEqual([]);
  });

  it("the matcher still bites the retired sales clause, and allows Briefing PDF attribution", () => {
    expect(
      namesGoalsAndForecastEtasAsClimbControls(
        "with goals and forecast ETAs so the climb stays on pace",
      ),
    ).toBe(true);
    expect(
      namesGoalsAndForecastEtasAsClimbControls(
        "Goal pace and forecast ETAs print on the Briefing PDF",
      ),
    ).toBe(false);
    expect(namesGoalsAndForecastEtasAsClimbControls("tracks the measurable path between")).toBe(
      false,
    );
  });
});
