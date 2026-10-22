// The marketing claim gate: every capability claim on /about and /about-org resolves to a shipping,
// non-alias capability, and a retired one fails here instead of being found by a reader.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { assertClaimsAnchored, featureClaims, resolveClaimAnchor, type AnchoredClaim } from "./claimAnchors";
import { ABOUT_FEATURES } from "./features";
import { ABOUT_ORG_FEATURES } from "../about-org/orgFeatures";
import { LOOP_STEPS } from "../about-org/loopSteps";
import { ORG_FAQ, orgFaqLd } from "../about-org/orgFaq";

const EM_DASH = "\u2014";

const SOURCES: Record<string, AnchoredClaim[]> = {
  ABOUT_FEATURES: ABOUT_FEATURES.flatMap(featureClaims),
  ABOUT_ORG_FEATURES: ABOUT_ORG_FEATURES.flatMap(featureClaims),
  ORG_FAQ: ORG_FAQ.map((q) => ({ text: q.answer, anchors: q.anchors })),
  LOOP_STEPS: LOOP_STEPS.map((s) => ({ text: s.detail, anchors: [{ tab: s.tab }] })),
};

const ALL_CLAIMS = Object.values(SOURCES).flat();

describe("resolveClaimAnchor", () => {
  it("accepts a rail panel (positive control)", () => {
    expect(resolveClaimAnchor({ tab: "proposals" })).toEqual({ ok: true });
  });

  it("accepts an off-rail sub-view that renders", () => {
    expect(resolveClaimAnchor({ tab: "segments" })).toEqual({ ok: true });
  });

  it("rejects an alias and names its target", () => {
    const v = resolveClaimAnchor({ tab: "followups" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/alias of proposals/);
  });

  it("rejects an id that is not an org tab", () => {
    const v = resolveClaimAnchor({ tab: "plan" as never });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/not an org tab/);
  });

  it("rejects an org view spelled as a route", () => {
    expect(resolveClaimAnchor({ route: "/org/acme" }).ok).toBe(false);
  });
});

describe("assertClaimsAnchored bites", () => {
  it("throws on a claim anchored to an alias, naming the claim and the alias target", () => {
    expect(() => assertClaimsAnchored([{ text: "Track it in the backlog", anchors: [{ tab: "followups" }] }])).toThrow(
      /Track it in the backlog.*proposals/,
    );
  });

  it("throws 'unanchored claim' on an empty anchor list", () => {
    expect(() => assertClaimsAnchored([{ text: "Trust us", anchors: [] }])).toThrow(/unanchored claim/);
  });

  it("lets an empty anchor list pass only when the claim is marked illustrative", () => {
    expect(() => assertClaimsAnchored([{ text: "Drag the slider", anchors: [], illustrative: true }])).not.toThrow();
  });
});

describe("every /about and /about-org claim is anchored", () => {
  it("every ABOUT_FEATURES entry carries anchors for its body and each point", () => {
    for (const f of ABOUT_FEATURES) {
      expect(f.anchors.body.length, f.id).toBeGreaterThan(0);
      expect(f.anchors.points.length, f.id).toBe(f.points.length);
    }
  });

  for (const [name, claims] of Object.entries(SOURCES)) {
    it(`${name}: every anchor resolves`, () => {
      expect(() => assertClaimsAnchored(claims, name)).not.toThrow();
    });
  }

  it("every route anchor names a route that exists under src/app", () => {
    const routes = ALL_CLAIMS.flatMap((c) => c.anchors).flatMap((a) => ("route" in a ? [a.route] : []));
    for (const r of routes) {
      const dir = join(process.cwd(), "src", "app", ...r.split("/").filter(Boolean));
      expect(existsSync(join(dir, "page.tsx")), r).toBe(true);
    }
  });

  it("no claim still sells a retired capability", () => {
    const retired = /full simulator inside \/org|every goal you set|leverage ranking|the backlog (carries|tracks)|what-if simulator, a shared/i;
    expect(ALL_CLAIMS.map((c) => c.text).filter((t) => retired.test(t))).toEqual([]);
  });

  it("no claim spells the dimension count as a word", () => {
    expect(ALL_CLAIMS.map((c) => c.text).filter((t) => /\bnine dimensions\b/i.test(t))).toEqual([]);
  });

  it("no claim carries an em dash", () => {
    expect(ALL_CLAIMS.map((c) => c.text).filter((t) => t.includes(EM_DASH))).toEqual([]);
  });
});

describe("ORG_FAQ is the single source of the FAQPage payload", () => {
  it("each rich-result answer is the ORG_FAQ answer, verbatim", () => {
    const ld = orgFaqLd();
    expect(ld.mainEntity.length).toBe(ORG_FAQ.length);
    ld.mainEntity.forEach((q, i) => {
      expect(q.name).toBe(ORG_FAQ[i]!.question);
      expect(q.acceptedAnswer.text).toBe(ORG_FAQ[i]!.answer);
    });
  });

  it("each FAQ entry carries at least one anchor, and no em dash", () => {
    for (const q of ORG_FAQ) {
      expect(q.anchors.length, q.question).toBeGreaterThan(0);
      expect(q.answer, q.question).not.toContain(EM_DASH);
    }
  });
});
