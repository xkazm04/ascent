// Pins dev-inspector #1 (ambiguity-ui-scan-2026-07-16): library classification is an ANCHORED
// prefix match against the repo's shared roots, not an any-segment substring test. The old
// `p.includes("/hooks/")`-style heuristic classified feature-LOCAL hooks/utils/ui folders
// (e.g. src/components/landing/hooks/) as library code, silently redirecting the default
// right-click copy target to a parent file — the exact wrong-file paste the tool exists to prevent.

import { describe, it, expect } from "vitest";
import { isLibraryPath, pickDefaultIndex, type LocEntry } from "./devLocate";

const entry = (path: string, line = 1): LocEntry =>
  ({ el: null as unknown as Element, path, line, loc: `${path}:${line}` });

describe("isLibraryPath — anchored shared roots", () => {
  it("classifies the real shared roots as library", () => {
    expect(isLibraryPath("src/lib/ui.ts")).toBe(true);
    expect(isLibraryPath("src/lib/org/security.ts")).toBe(true);
    expect(isLibraryPath("src/components/ui/Modal.tsx")).toBe(true);
    expect(isLibraryPath("src/components/org/shared/CreditsControl.tsx")).toBe(true);
    expect(isLibraryPath("src/app/_dev-inspector/devLocate.ts")).toBe(true);
  });

  it("does NOT classify feature-local hooks/utils/ui folders as library (the old substring bug)", () => {
    expect(isLibraryPath("src/components/landing/hooks/useHero.ts")).toBe(false);
    expect(isLibraryPath("src/components/connect/utils/format.ts")).toBe(false);
    expect(isLibraryPath("src/app/connect/utils/Panel.tsx")).toBe(false);
    expect(isLibraryPath("src/components/report/ui/Sparkline.tsx")).toBe(false);
  });

  it("plain feature/page files are never library", () => {
    expect(isLibraryPath("src/components/landing/Hero.tsx")).toBe(false);
    expect(isLibraryPath("src/app/connect/page.tsx")).toBe(false);
  });

  it("tolerates './'-prefixed stamps", () => {
    expect(isLibraryPath("./src/lib/ui.ts")).toBe(true);
    expect(isLibraryPath("./src/components/landing/hooks/useHero.ts")).toBe(false);
  });
});

describe("pickDefaultIndex — default copy target", () => {
  it("keeps a feature-local hooks file as the innermost default (was silently skipped before)", () => {
    const chain = [entry("src/components/landing/hooks/HeroPanel.tsx"), entry("src/app/page.tsx")];
    expect(pickDefaultIndex(chain)).toBe(0);
  });

  it("still skips genuine shared-root files to the call site", () => {
    const chain = [entry("src/components/ui/Modal.tsx"), entry("src/components/landing/Hero.tsx"), entry("src/app/page.tsx")];
    expect(pickDefaultIndex(chain)).toBe(1);
  });

  it("falls back to the innermost entry when the whole chain is library code", () => {
    const chain = [entry("src/components/ui/Modal.tsx"), entry("src/lib/ui.ts")];
    expect(pickDefaultIndex(chain)).toBe(0);
  });
});
