// Plans do not sell a seat count (operator decision, backlog develop-2026-09-17 row 45, recorded in
// docs/scan-sweep-risk-plan-2026-09-22.md). Every card advertised "1 / 3 / 10 members" and the matrix
// a "Members / seats" row, while no membership, invite or authz path ever read `PlanFeature.seats`.
// The choice was enforce or stop selling; the product stopped selling. This file pins that no pricing
// surface re-advertises a seat or member count, two ways:
//
//   1. the rendered DATA: every plan's blurb/bullets, every credit-matrix row, every self-host diff row;
//   2. the SOURCE of every module that sells a tier, with comments stripped (a comment may explain the
//      history; only code and copy count), so a new literal or a re-added `seats` field fails here
//      before it reaches a page. A seeded violation proves the matcher still bites.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { PLAN_FEATURES, PLAN_ORDER } from "@/lib/plans";
import { MATRIX_GROUPS, PLANNED_NOTE } from "./creditMatrixData";
import { CAPABILITY_DIFF } from "./selfHostPricingData";

/** A seat word, or a head count of members/teammates ("3 members", "Unlimited members"). */
const SEAT_CLAIM = [
  /\bseats?\b/i,
  /\b(?:\d+|one|two|three|five|ten|unlimited)\s+(?:team\s*)?(?:members?|teammates|users)\b/i,
  /\bhow many teammates\b/i,
];
const seatClaims = (text: string) => SEAT_CLAIM.filter((re) => re.test(text)).map((re) => re.source);

/** Drop line and block comments, keep every string and template literal (the copy is what we check). */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const ROOT = join(__dirname, "..", "..", "..");
const nonTest = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${dir}/${f}`);

/** Every module that sells a tier: the plan model, the pricing page, its components, the landing
 *  pricing section, the landing page FAQ and the structured-data offers. */
const SELLING_SURFACES = [
  "src/lib/plans.ts",
  "src/lib/site-jsonld.ts",
  "src/app/page.tsx",
  "src/components/landing/prototypes/index/IndexPricing.tsx",
  ...nonTest("src/app/pricing"),
  ...nonTest("src/components/pricing"),
];

describe("pricing surfaces sell no seat count", () => {
  it("no plan carries a seats field, so no surface can render one", () => {
    for (const id of PLAN_ORDER) expect(Object.keys(PLAN_FEATURES[id]), id).not.toContain("seats");
  });

  it("no plan card's blurb or bullet states a seat or member count", () => {
    for (const id of PLAN_ORDER) {
      for (const text of [PLAN_FEATURES[id].blurb, ...PLAN_FEATURES[id].features]) {
        expect(seatClaims(text), `${id}: ${text}`).toEqual([]);
      }
    }
  });

  it("no credit-matrix row sells seats, in its label, detail or any tier cell", () => {
    for (const row of MATRIX_GROUPS.flatMap((g) => g.rows)) {
      const texts = [row.label, row.detail, ...Object.values(row.cells).filter((c) => typeof c === "string")];
      for (const text of texts) expect(seatClaims(text as string), `${row.label}: ${text}`).toEqual([]);
    }
    expect(seatClaims(PLANNED_NOTE)).toEqual([]);
  });

  it("the self-host comparison has no seat row", () => {
    for (const row of CAPABILITY_DIFF) {
      for (const text of [row.label, row.cloud, row.local]) expect(seatClaims(text), `${row.label}: ${text}`).toEqual([]);
    }
  });

  it("no selling module's code or copy (comments stripped) names a seat or member count", () => {
    expect(SELLING_SURFACES.length).toBeGreaterThan(8);
    for (const path of SELLING_SURFACES) {
      const code = stripComments(readFileSync(join(ROOT, path), "utf8"));
      expect(seatClaims(code), path).toEqual([]);
    }
  });

  it("seeded violation: the matcher bites on a literal and a field, and ignores a comment", () => {
    const bad = `const spec = { seats: 3, extras: ["Org fleet dashboard", "10 members"] };`;
    expect(seatClaims(stripComments(bad)).length).toBeGreaterThan(0);
    expect(seatClaims(stripComments(`const x = ["Unlimited members"];`)).length).toBeGreaterThan(0);
    const commentOnly = `// the old cards sold "3 members" and seats\n/* seats: 3 */\nconst url = "https://x.test//a";`;
    expect(stripComments(commentOnly)).toContain("https://x.test//a");
    expect(seatClaims(stripComments(commentOnly))).toEqual([]);
  });
});
