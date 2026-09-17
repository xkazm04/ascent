// Pure WCAG contrast helpers used by BrandingSettings. Extracted from BrandingSettings.test.tsx
// so that file stays under the 200-LOC src/features cap.

import { describe, it, expect } from "vitest";
import {
  accentContrastOnDark,
  accentContrastOnWhite,
  accentContrastWarning,
  MIN_ACCENT_CONTRAST,
  SHARE_CHROME_INK,
} from "./brandingContrast";

describe("accent contrast helper", () => {
  it("passes the readable default blue on white and dark share chrome (>= 3:1)", () => {
    expect(accentContrastOnWhite("#2563eb")).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accentContrastOnDark("#2563eb")).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accentContrastWarning("#2563eb")).toBeNull();
  });

  it("flags a light accent that nearly vanishes on white", () => {
    expect(accentContrastOnWhite("#ffff00")).toBeLessThan(MIN_ACCENT_CONTRAST); // pure yellow ≈ 1.07:1
    const warning = accentContrastWarning("#eab308");
    expect(warning).toMatch(/low contrast/i);
    expect(warning).toMatch(/white briefing PDF/);
    expect(warning).toMatch(/:1/);
    expect(warning).not.toMatch(/share chrome/i);
  });

  it("flags a dark accent that nearly vanishes on share chrome even when the white PDF is fine", () => {
    expect(accentContrastOnWhite("#0f172a")).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(accentContrastOnDark("#0f172a")).toBeLessThan(MIN_ACCENT_CONTRAST);
    expect(accentContrastOnDark(SHARE_CHROME_INK)).toBeLessThan(MIN_ACCENT_CONTRAST);
    const warning = accentContrastWarning("#0f172a");
    expect(warning).toMatch(/low contrast/i);
    expect(warning).toMatch(/share chrome/i);
    expect(warning).toMatch(/:1/);
    expect(warning).not.toMatch(/white briefing PDF/);
  });

  it("does not false-alarm on a malformed colour", () => {
    expect(accentContrastWarning("not-a-hex")).toBeNull();
    expect(Number.isNaN(accentContrastOnWhite("#zzz"))).toBe(true);
    expect(Number.isNaN(accentContrastOnDark("#zzz"))).toBe(true);
  });
});
