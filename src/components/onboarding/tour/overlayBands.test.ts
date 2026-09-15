// Overlay precedence: the tour is a citizen, not the top band.
//
// The guided-setup drawer sat at `z-[55]` while the app's modal band is `z-50` (ui/Modal and the
// landing ScanModal both dim the page at that level). So opening any dialog left the coaching drawer
// and its pull tab painted on top of the dialog's own backdrop — still clickable, while everything the
// user actually asked for was dimmed underneath. Coaching is the most interruptible content in the
// product: a dialog outranks it, always.
//
// The order is three magic numbers in three files, which is exactly the shape that drifts silently — a
// z-index is edited to fix one screen and nobody checks the band it just crossed. Read them out of the
// source and assert the order instead.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/** Strip comments first: this repo explains its layering in prose beside the class strings, and the
 *  paragraph above literally contains "z-[55]". A matcher over raw text would read that as the code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(rel: string): string {
  return stripComments(readFileSync(resolve(process.cwd(), rel), "utf8"));
}

/** The first z-index on a `fixed`/`absolute` overlay in this file, as a number. */
function zIndexOf(rel: string): number {
  const src = read(rel);
  const bracket = src.match(/\bz-\[(\d+)\]/);
  if (bracket) return Number(bracket[1]);
  const scale = src.match(/\bz-(\d{2,})\b/);
  if (!scale) throw new Error(`no z-index found in ${rel}`);
  return Number(scale[1]);
}

describe("the tour ranks below the modal band", () => {
  const drawer = zIndexOf("src/components/onboarding/tour/TourChecklist.tsx");
  const ring = zIndexOf("src/components/onboarding/tour/HighlightLayer.tsx");
  const modal = zIndexOf("src/components/ui/Modal.tsx");

  it("found all three bands (a matcher that stopped matching must not pass)", () => {
    for (const [name, z] of [["drawer", drawer], ["ring", ring], ["modal", modal]] as const) {
      expect(z, `${name} z-index`).toBeGreaterThan(0);
    }
  });

  it("a dialog paints over the coaching drawer, not under it", () => {
    expect(drawer).toBeLessThan(modal);
  });

  it("the spotlight ring also yields to a dialog", () => {
    expect(ring).toBeLessThan(modal);
  });

  it("the drawer still sits above its own spotlight ring", () => {
    expect(drawer).toBeGreaterThan(ring);
  });
});
