// branding-1: brandingVerdictModel turns the server's no-write verdict into what the form shows: a
// note per field (with the server's reason), the preview's logo state, and a Save button that names
// what it is about to destroy. Pure; no DOM.

import { describe, it, expect } from "vitest";
import { brandingVerdictModel, type BrandingCheckVerdict } from "./brandingVerdictModel";

const draft = (over: Partial<{ brandName: string; brandColor: string; logoUrl: string }> = {}) => ({
  brandName: "",
  brandColor: "",
  logoUrl: "",
  ...over,
});

function verdict(over: Partial<BrandingCheckVerdict> = {}): BrandingCheckVerdict {
  return { rejected: [], reasons: {}, logo: "ok", contrast: { onWhite: 5.2, onDark: 3.6 }, ...over };
}

describe("brandingVerdictModel", () => {
  it("a rejected URL replacing a working logo is destructive and says so", () => {
    const m = brandingVerdictModel({
      storedLogoUrl: "https://old.acme.com/l.png",
      draft: draft({ logoUrl: "http://new.acme.com/l.png" }),
      verdict: { rejected: ["logoUrl"], reasons: { logoUrl: "not-https" } },
    });
    expect(m.saveIntent).toBe("destructive");
    expect(m.saveLabel).toBe("Save and remove the current logo");
    expect(m.notes.logoUrl).toBe("Must be an https URL");
    expect(m.logoVerdict).toBe("rejected");
  });

  it("a clean verdict is a plain Save with no notes", () => {
    const m = brandingVerdictModel({ storedLogoUrl: null, draft: draft({ logoUrl: "https://acme.com/l.png" }), verdict: verdict() });
    expect(m).toMatchObject({ saveIntent: "plain", saveLabel: "Save", notes: {}, logoVerdict: "ok" });
  });

  it("an unreachable logo warns that the PDF would have no logo", () => {
    const m = brandingVerdictModel({ storedLogoUrl: null, draft: draft({ logoUrl: "https://acme.com/l.png" }), verdict: verdict({ logo: "unreachable" }) });
    expect(m.saveIntent).toBe("warn");
    expect(m.saveLabel).toBe("Save anyway");
    expect(m.notes.logoUrl).toBe("This URL didn't return an image, so the PDF would have no logo");
    expect(m.logoVerdict).toBe("unreachable");
  });

  it("an unreachable replacement for a working logo is destructive", () => {
    const m = brandingVerdictModel({
      storedLogoUrl: "https://old.acme.com/l.png",
      draft: draft({ logoUrl: "https://new.acme.com/l.png" }),
      verdict: verdict({ logo: "unreachable", logoReason: "unsupported-format" }),
    });
    expect(m.saveIntent).toBe("destructive");
    expect(m.notes.logoUrl).toBe("This image isn't PNG, JPEG or SVG, so the PDF would have no logo");
  });

  it("clearing the logo field over a stored logo names the removal", () => {
    const m = brandingVerdictModel({ storedLogoUrl: "https://old.acme.com/l.png", draft: draft(), verdict: null });
    expect(m.saveIntent).toBe("destructive");
    expect(m.saveLabel).toBe("Save and remove the current logo");
  });

  it("names the colour, private-host and too-long reasons", () => {
    const m = brandingVerdictModel({
      storedLogoUrl: null,
      draft: draft({ brandColor: "blue", logoUrl: "https://10.0.0.1/l.png" }),
      verdict: { rejected: ["brandColor", "logoUrl"], reasons: { brandColor: "not-hex", logoUrl: "private-host" } },
    });
    expect(m.saveIntent).toBe("warn");
    expect(m.notes.brandColor).toBe("Must be a #rrggbb hex colour");
    expect(m.notes.logoUrl).toBe("Must be a public host, not a private or internal address");
    const long = brandingVerdictModel({ storedLogoUrl: null, draft: draft({ logoUrl: "x" }), verdict: { rejected: ["logoUrl"], reasons: { logoUrl: "too-long" } } });
    expect(long.notes.logoUrl).toBe("Must be 500 characters or fewer");
  });

  it("notes a name the save would shorten, and warns on low contrast", () => {
    const m = brandingVerdictModel({
      storedLogoUrl: null,
      draft: draft({ brandName: "x".repeat(90) }),
      verdict: verdict({ logo: "none", branding: { brandName: "x".repeat(80), brandColor: null, logoUrl: null }, contrast: { onWhite: 1.2, onDark: 9 } }),
    });
    expect(m.notes.brandName).toBe("Will be shortened to 80 characters");
    expect(m.saveIntent).toBe("warn");
  });

  it("with no verdict yet: a plain Save, nothing claimed about the logo", () => {
    const m = brandingVerdictModel({ storedLogoUrl: null, draft: draft({ logoUrl: "https://acme.com/l.png" }), verdict: null });
    expect(m).toMatchObject({ saveIntent: "plain", saveLabel: "Save", notes: {}, logoVerdict: "unchecked" });
  });

  it("writes no em dash in any copy it produces", () => {
    const m = brandingVerdictModel({
      storedLogoUrl: "https://old.acme.com/l.png",
      draft: draft({ brandName: "x".repeat(90), brandColor: "blue", logoUrl: "http://x" }),
      verdict: { rejected: ["brandColor", "logoUrl"], reasons: { brandColor: "not-hex", logoUrl: "not-https" }, branding: { brandName: "x".repeat(80), brandColor: null, logoUrl: null } },
    });
    const text = [m.saveLabel, ...Object.values(m.notes)].join(" ");
    expect(text).not.toContain("\u2014");
  });
});
