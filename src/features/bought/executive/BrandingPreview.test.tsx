// @vitest-environment jsdom
// branding-1: the PDF-header mock shows a logo only when the server has not said the PDF won't get
// one. The browser can load a URL (redirect, hotlink allowance) that the PDF's guarded fetch refuses.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandingPreview } from "./BrandingPreview";

const props = { brandName: "Acme", brandColor: "#c41e3a", logoUrl: "https://acme.com/l.png" };

describe("BrandingPreview logo verdict", () => {
  it.each(["unreachable", "rejected"] as const)("logoVerdict %j renders no <img> and says the PDF has no logo", (logoVerdict) => {
    render(<BrandingPreview {...props} logoVerdict={logoVerdict} />);
    const card = screen.getByRole("region", { name: /pdf header preview/i });
    expect(card.querySelector("img")).toBeNull();
    expect(screen.getByText("No logo in the PDF")).toBeInTheDocument();
    expect(card.textContent).not.toContain("\u2014");
  });

  it.each(["ok", "unchecked", undefined] as const)("logoVerdict %j still renders the logo", (logoVerdict) => {
    render(<BrandingPreview {...props} logoVerdict={logoVerdict} />);
    expect(screen.getByRole("region", { name: /pdf header preview/i }).querySelector("img")).not.toBeNull();
    expect(screen.queryByText("No logo in the PDF")).toBeNull();
  });
});
