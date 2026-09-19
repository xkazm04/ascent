// The anchor contract, gated against the SOURCE rather than against itself.
//
// Every tour spotlight is a `data-tour` string that has to resolve to a real element at runtime. Two
// places declare those strings — ORG_TOUR_STEPS (the teach library) and GETTING_STARTED_ANCHORS (the
// server-derived tasks) — and the elements are stamped somewhere else entirely, by whoever owns the
// control. getting-started.ts states the intent: "declared HERE and stamped onto their elements by the
// UI lane — one shared constant so the model and the DOM can't drift."
//
// A shared constant is not a gate. `backlog-recs` was declared and never stamped, so the `gap-engaged`
// step told the engine to spotlight a control that existed nowhere; the engine polled, gave up, and
// degraded silently. The one test that touched anchors asserted `step.anchor === ANCHORS[step.id]` —
// the constant compared to itself, which passes whether or not the element exists.
//
// So this builds the inventory the contract needs: every `data-tour="…"` attribute actually present in
// the tree, and every declared anchor checked against it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { ORG_TOUR_STEPS } from "./steps";
import { GETTING_STARTED_ANCHORS } from "@/lib/org/getting-started";

const SRC = resolve(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Strip `//` and block comments before matching. Every stamp site in this repo explains itself in a
 * comment directly above the attribute ("data-tour: the onboarding companion's … spotlight"), so a
 * matcher run over raw text can be satisfied by a file that only TALKS about an anchor.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `data-tour` identifier stamped on a real element, extracted from the product source. */
function stampedAnchors(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    for (const m of stripComments(readFileSync(file, "utf8")).matchAll(/data-tour="([\w-]+)"/g)) {
      found.add(m[1]!);
    }
  }
  return found;
}

const DECLARED: [source: string, anchor: string][] = [
  ...ORG_TOUR_STEPS.map((s) => [`ORG_TOUR_STEPS.${s.id}`, s.anchor] as [string, string]),
  ...Object.entries(GETTING_STARTED_ANCHORS).map(
    ([id, anchor]) => [`GETTING_STARTED_ANCHORS.${id}`, anchor] as [string, string],
  ),
];

describe("tour anchors resolve to elements that exist in the source", () => {
  const stamped = stampedAnchors();

  it("finds the stamped anchors at all (a scanner that matches nothing must not pass)", () => {
    // Without this, a regex that stopped matching would report every anchor as fine.
    expect(stamped.size).toBeGreaterThanOrEqual(5);
    expect(stamped.has("modules-nav")).toBe(true);
  });

  it("every DECLARED anchor is stamped on some element", () => {
    const dangling = DECLARED.filter(([, anchor]) => !stamped.has(anchor)).map(
      ([where, anchor]) => `${where} -> data-tour="${anchor}"`,
    );
    expect(dangling).toEqual([]);
  });

  it("declares at least one anchor from each of the two authorities", () => {
    // Guards the inverse vacuity: an empty DECLARED list would satisfy the case above.
    expect(ORG_TOUR_STEPS.length).toBeGreaterThan(0);
    expect(Object.keys(GETTING_STARTED_ANCHORS).length).toBeGreaterThan(0);
  });
});
