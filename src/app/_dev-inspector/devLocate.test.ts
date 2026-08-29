// Pins dev-inspector #1 (ambiguity-ui-scan-2026-07-16): library classification is an ANCHORED
// prefix match against the repo's shared roots, not an any-segment substring test. The old
// `p.includes("/hooks/")`-style heuristic classified feature-LOCAL hooks/utils/ui folders
// (e.g. src/components/landing/hooks/) as library code, silently redirecting the default
// right-click copy target to a parent file — the exact wrong-file paste the tool exists to prevent.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";
import { isLibraryPath, LIBRARY_ROOTS, pickDefaultIndex, type LocEntry } from "./devLocate";

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

// LIBRARY_ROOTS is a hand-maintained snapshot of the repo's shared roots, and its own comment says it
// MUST track layout when shared code moves. Nothing enforced that: every other case in this file
// re-types the same four prefixes, so a renamed or deleted root would leave the suite fully green
// while the default copy target silently stopped being redirected — the exact dev-inspector #1
// regression, arriving invisibly. This case reads the list itself and checks it against the tree.
describe("LIBRARY_ROOTS — the list tracks the real repo layout", () => {
  it("every declared shared root exists as a directory", () => {
    const missing = LIBRARY_ROOTS.filter((root) => {
      const abs = resolve(process.cwd(), root);
      return !existsSync(abs) || !statSync(abs).isDirectory();
    });
    expect(missing).toEqual([]);
  });

  it("every entry is an anchored, slash-terminated repo-relative prefix", () => {
    for (const root of LIBRARY_ROOTS) {
      expect(root.startsWith("src/")).toBe(true);
      expect(root.endsWith("/")).toBe(true);
    }
  });

  it("the inspector's own source is a shared root, so a resolution can never land on the tool", () => {
    expect(isLibraryPath("src/app/_dev-inspector/DevInspector.tsx")).toBe(true);
  });
});
