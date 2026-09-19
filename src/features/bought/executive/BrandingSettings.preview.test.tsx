// @vitest-environment jsdom
// Pins the live PDF-header mock and branded PDF download (extracted so BrandingSettings.test.tsx
// stays under the 200-LOC src/features cap).

import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OrgBranding } from "@/lib/db/branding";
import { BrandingSettings } from "./BrandingSettings";

function branding(over: Partial<OrgBranding> = {}): OrgBranding {
  return { brandName: null, brandColor: null, logoUrl: null, ...over } as OrgBranding;
}

describe("BrandingSettings live PDF-header mock (DOM)", () => {
  it("shows brand name, accent hex and logo on a light preview card", () => {
    render(<BrandingSettings slug="acme" initial={branding()} />);
    fireEvent.change(screen.getByPlaceholderText("Acme Inc."), { target: { value: "Acme Inc." } });
    fireEvent.change(screen.getByLabelText("Accent colour hex"), { target: { value: "#c41e3a" } });
    fireEvent.change(screen.getByPlaceholderText("https://acme.com/logo.png"), { target: { value: "https://cdn.example/acme.png" } });
    const card = screen.getByRole("region", { name: /pdf header preview/i });
    expect(card.className).toMatch(/bg-white/);
    expect(card.textContent).toMatch(/Acme Inc/);
    expect(card.textContent).toMatch(/#c41e3a/i);
    expect(card.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/acme.png");
  });
});

describe("BrandingSettings branded PDF download (DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("offers DownloadButton at /api/org/briefing/pdf?org=", () => {
    render(<BrandingSettings slug="acme" initial={branding()} />);
    expect(screen.getByRole("link", { name: /download branded pdf/i })).toHaveAttribute("href", "/api/org/briefing/pdf?org=acme");
  });

  it("disables the download while a save is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
    render(<BrandingSettings slug="acme" initial={branding()} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled());
    expect(screen.getByRole("link", { name: /download branded pdf/i })).toHaveClass("pointer-events-none");
  });
});
