// THE READABLE FLOOR — every colour this app writes TEXT in, measured against the canvas it sits on.
//
// The app is dark-only, and most of its de-emphasised text is written with the stock slate ramp,
// whose bottom two shades are below the readable floor on #080d1a (slate-600 was 2.56:1, slate-500
// 4.08:1 — WCAG AA asks 4.5:1 for body text). globals.css re-bases those two rather than sweeping
// 1399 utility call sites; this test is what keeps the re-base honest, because a palette regression
// is invisible in review — the diff is one hex, and the damage is spread over three hundred files.
//
// It reads the OVERRIDES out of globals.css rather than restating them, so the test cannot drift
// from the stylesheet; the shades the app does not override are Tailwind's own, listed here as the
// constants they are.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** `--color-<name>: #rrggbb` from the `@theme` block. */
function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`globals.css declares no --color-${name}`);
  return m[1]!.toLowerCase();
}

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => srgb(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2.1 contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const INK = token("ink");
// Tailwind's own shades, which the app uses above its re-based floor and does not redefine.
const SLATE_400 = "#94a3b8";
const SLATE_300 = "#cbd5e1";
const SLATE_200 = "#e2e8f0";

describe("text colour contrast on the canvas", () => {
  // 4.5:1 is the AA floor for body text. Every colour here is used with `text-*` in the app.
  it.each([
    ["slate-500 — the workhorse muted text", token("slate-500")],
    ["slate-400", SLATE_400],
    ["slate-300", SLATE_300],
    ["slate-200", SLATE_200],
    ["accent", token("accent")],
    ["accent-soft", token("accent-soft")],
    ["danger", token("danger")],
    ["danger-soft", token("danger-soft")],
    ["warn", token("warn")],
    ["success", token("success")],
    ["success-soft", token("success-soft")],
    ["tone-flat", token("tone-flat")],
    ["tone-rising", token("tone-rising")],
  ])("%s clears AA for body text", (_name, hex) => {
    expect(contrast(hex, INK)).toBeGreaterThanOrEqual(4.5);
  });

  // slate-600 is the ramp's floor and is deliberately under the body-text bar: it is for marks,
  // ids and em-dash placeholders, never paragraphs. It still has to clear AA-large (3:1) with room,
  // which the stock #475569 (2.56:1) did not.
  it("slate-600 is the de-emphasis step, legible even so", () => {
    const ratio = contrast(token("slate-600"), INK);
    expect(ratio).toBeGreaterThanOrEqual(4.0);
    expect(ratio).toBeLessThan(contrast(token("slate-500"), INK));
  });

  it("keeps the ramp's order, so nothing that leans on the hierarchy inverts", () => {
    const ladder = [token("slate-600"), token("slate-500"), SLATE_400, SLATE_300, SLATE_200].map((h) => contrast(h, INK));
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
  });

  it("measures text ON the accent against the accent, not the canvas", () => {
    expect(contrast(token("on-accent"), token("accent"))).toBeGreaterThanOrEqual(4.5);
  });
});
