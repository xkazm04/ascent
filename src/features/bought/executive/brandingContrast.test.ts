// Pure WCAG contrast helpers used by BrandingSettings. Extracted from BrandingSettings.test.tsx
// so that file stays under the 200-LOC src/features cap.

import { describe, it, expect } from "vitest";
import { accentContrastOnWhite, accentContrastWarning, MIN_ACCENT_CONTRAST } from "./brandingContrast";

describe("accent contrast helper", () => {
  it("passes the readable default blue on white (>= 3:1)", () => {
    expect(accentContrastOnWhite("#2563eb")).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accentContrastWarning("#2563eb")).toBeNull();
  });

  it("flags a light accent that nearly vanishes on white", () => {
    expect(accentContrastOnWhite("#ffff00")).toBeLessThan(MIN_ACCENT_CONTRAST); // pure yellow ≈ 1.07:1
    const warning = accentContrastWarning("#eab308");
    expect(warning).toMatch(/low contrast/i);
    expect(warning).toMatch(/:1/);
  });

  it("does not false-alarm on a malformed colour", () => {
    expect(accentContrastWarning("not-a-hex")).toBeNull();
    expect(Number.isNaN(accentContrastOnWhite("#zzz"))).toBe(true);
  });
});
