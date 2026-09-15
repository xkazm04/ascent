// The exemplar diff's DISCOVERY PATH (UAT `SAM-L1-13`).
//
// The exemplar comparison — "what does a stronger repo have at the evidence level that this one
// lacks" — was reachable only by typing `?against=` into the URL. The report's one link into the
// compare surface is the time diff's "What changed →", which is gated on two scans and carries no
// `against` token, so the panel shipped with no inbound path at all.
//
// A structural test rather than a DOM one because the failure mode is the link being DELETED or
// re-gated, not it rendering wrong: this file has no test harness of its own, and a source assertion
// is what stops a future edit from quietly closing the path again.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(join(process.cwd(), "src/components/report/ScoringTab.tsx"), "utf8");

describe("ScoringTab — the report links INTO the exemplar comparison", () => {
  it("carries an ?against= link, so the exemplar diff is reachable without hand-editing a URL", () => {
    expect(src).toMatch(/against=org:best/);
  });

  it("does not gate that link on two scans — comparing against another repo needs no second scan", () => {
    // Everything inside the `scans.length >= 2 && (…)` block is the TIME diff's entrance. The
    // exemplar link must sit outside it.
    const gated = /scans\.length >= 2 && \([\s\S]*?\n\s{12}\)\}/.exec(src)?.[0] ?? "";
    expect(gated).not.toBe("");
    expect(gated).not.toMatch(/against=org:best/);
  });
});
