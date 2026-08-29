// The brand copy in lib/site is single-sourced so the shell's three description slots — the search
// snippet (layout metadata + JSON-LD), the PWA install card (manifest.ts) and the social card (the
// root opengraph-image) — cannot contradict each other or the maturity model. That claim has been in
// the file's header since the rubric COUNTS were centralized, but only the counts were: manifest and
// the OG route each re-typed the sentence, so a level or dimension added to the model updated one
// snippet and left two behind, in wordings nobody could diff.
//
// These pin the part that actually drifts: every variant derives its numbers from the model, and the
// three stay distinct slots rather than collapsing into an accidental copy of one another.
import { describe, it, expect } from "vitest";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import {
  DIMENSION_COUNT,
  FEEDBACK_URL,
  jsonLdScript,
  LEVEL_COUNT,
  SITE_TAGLINE,
  SITE_TAGLINE_TITLE,
  siteDescription,
  siteDescriptionCard,
  siteDescriptionShort,
} from "./site";

const VARIANTS = {
  meta: siteDescription,
  short: siteDescriptionShort,
  card: siteDescriptionCard,
};

describe("brand copy is derived from the maturity model", () => {
  it("the exported counts equal the model's own", () => {
    expect(LEVEL_COUNT).toBe(LEVELS.length);
    expect(DIMENSION_COUNT).toBe(DIMENSIONS.length);
  });

  it("every description variant states the CURRENT level and dimension counts", () => {
    for (const [name, fn] of Object.entries(VARIANTS)) {
      const text = fn();
      expect(text, `${name} must state the level count`).toContain(`${LEVELS.length}-level`);
      expect(text, `${name} must state the dimension count`).toContain(`${DIMENSIONS.length} dimensions`);
      // A stale hardcoded count is the exact failure this guards; make sure no OTHER number of
      // dimensions is being claimed alongside the right one.
      expect(text).not.toMatch(new RegExp(`\\b(?!${DIMENSIONS.length}\\b)\\d+ dimensions`));
    }
  });

  it("the three variants stay distinct slots (a collapse would mean one surface lost its voice)", () => {
    const texts = Object.values(VARIANTS).map((fn) => fn());
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("tagline casing is derived, not re-typed", () => {
  it("SITE_TAGLINE_TITLE is SITE_TAGLINE with a capital lead and nothing else changed", () => {
    expect(SITE_TAGLINE_TITLE.toLowerCase()).toBe(SITE_TAGLINE.toLowerCase());
    expect(SITE_TAGLINE_TITLE[0]).toBe(SITE_TAGLINE[0]!.toUpperCase());
  });
});

describe("FEEDBACK_URL follows the deployment's own repository", () => {
  it("is an absolute https issues URL", () => {
    expect(FEEDBACK_URL).toMatch(/^https:\/\/\S+\/issues$/);
  });
});

// The HTML parser ends a <script> block at the first literal `</script`, wherever it occurs —
// including inside a JSON string. Three surfaces inline JSON-LD this way; the root layout's payload
// interpolates an env-derived base URL, so "static, no user input" was already untrue there.
describe("jsonLdScript — a value can never terminate the script block", () => {
  it("escapes `<` so `</script>` in a value cannot close the tag", () => {
    const out = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
  });

  it("round-trips: the escape is JSON, so the parsed value is unchanged", () => {
    const value = { name: "a</script>b", url: "https://x.dev/<>" };
    expect(JSON.parse(jsonLdScript(value))).toEqual(value);
  });

  it("escapes the JS line terminators U+2028/U+2029, which are legal inside JSON strings", () => {
    // Built from char codes: a literal U+2028 in this file would be invisible in review and could
    // be normalised away by an editor, turning this case green without testing anything.
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const value = { name: `a${LS}b${PS}c` };
    const out = jsonLdScript(value);
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
    expect(JSON.parse(out)).toEqual(value);
  });

  it("leaves an ordinary payload byte-identical to JSON.stringify", () => {
    const value = { "@context": "https://schema.org", name: "Ascent" };
    expect(jsonLdScript(value)).toBe(JSON.stringify(value));
  });
});
