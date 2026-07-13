// @vitest-environment jsdom
//
// Pins org-branding-white-label #1: the accent colour is validated for readability against the WHITE
// briefing PDF and a NON-BLOCKING warning is shown (the value is still saved) when it falls below the
// WCAG large-text / UI 3:1 ratio. Covers both the pure ratio helper and the rendered advisory wired to
// the colour input via aria-describedby.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OrgBranding } from "@/lib/db/branding";
import { BrandingSettings, accentContrastOnWhite, accentContrastWarning, MIN_ACCENT_CONTRAST } from "./BrandingSettings";

function branding(over: Partial<OrgBranding> = {}): OrgBranding {
  return { brandName: null, brandColor: null, logoUrl: null, ...over } as OrgBranding;
}

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

describe("BrandingSettings contrast advisory (DOM)", () => {
  it("shows a non-blocking warning wired to the accent input for a low-contrast colour", () => {
    render(<BrandingSettings slug="acme" initial={branding({ brandColor: "#ffee00" })} />);
    const warning = screen.getByText(/low contrast/i);
    expect(warning.closest("p")).toHaveAttribute("id", "brand-accent-warning");
    const colorInput = document.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(colorInput).toHaveAttribute("aria-describedby", "brand-accent-warning");
  });

  it("shows no warning for a readable accent", () => {
    render(<BrandingSettings slug="acme" initial={branding({ brandColor: "#1d4ed8" })} />);
    expect(screen.queryByText(/low contrast/i)).toBeNull();
    const colorInput = document.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(colorInput).not.toHaveAttribute("aria-describedby");
  });
});
