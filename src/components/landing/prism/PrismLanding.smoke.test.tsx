// @vitest-environment jsdom
//
// Render smoke for the Prism landing. The canvas engine is browser-only (rAF, canvas, IntersectionObserver),
// so this pins the SERVER render: the markup a visitor and a crawler get before any script runs. It must
// carry the real rubric (nine dimensions, weights, five levels), the deployment's real wiring (no
// hard-coded source URL, the scan dialog opened through ?scan=1), and the honesty labels on every invented
// example. The interactive behaviour is pinned separately (PrismScene.dom.test.tsx, PrismLadder.dom.test.tsx).

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ARCHETYPE_WEIGHTS, DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { PRISM_SCAN_HREF, SELF_HOST_HREF, type PrismLinks } from "./prismLinks";

// The real ScanModal reads the Next router; its own suite covers it. Here it only has to be mounted.
vi.mock("@/components/shared/scan/ScanModal", () => ({
  ScanModal: () => <span data-testid="scan-modal" />,
}));

import { PrismLanding } from "./PrismLanding";

const LINKS: PrismLinks = { scan: PRISM_SCAN_HREF, org: "/org/demo", source: null };
const render = (links: PrismLinks = LINKS) => renderToStaticMarkup(<PrismLanding links={links} auth={null} gated={false} />);

describe("PrismLanding (server render)", () => {
  const html = render();

  it("renders one labelled line per product dimension, weighted for the default org lens", () => {
    const labels = html.match(/class="ray-label"/g) ?? [];
    expect(labels).toHaveLength(DIMENSIONS.length);
    for (const d of DIMENSIONS) {
      expect(html).toContain(d.name.replace(/&/g, "&amp;"));
      expect(html).toContain(`${Math.round(ARCHETYPE_WEIGHTS.org[d.id] * 100)}%`);
    }
  });

  it("renders the five levels as plates, top level first", () => {
    const plates = html.match(/class="plate"/g) ?? [];
    expect(plates).toHaveLength(LEVELS.length);
    expect(html.indexOf("Autonomous")).toBeLessThan(html.lastIndexOf("Manual"));
  });

  it("has the sections the nav and the hash anchors point at, in order", () => {
    const ids = ["hero", "lines", "ladder", "method", "beyond", "brand", "launch"].map((id) => html.indexOf(`id="${id}"`));
    expect(ids.every((i) => i >= 0)).toBe(true);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(html).toContain('id="main"');
  });

  it("starts with the scene closed and the intro not yet handed over", () => {
    expect(html).toMatch(/id="scene"[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/class="prism-root[^"]*(ready|labels)/);
    expect(html).toContain("Skip intro");
  });

  it("opens the real scan dialog through the deep link, never a dead-end", () => {
    expect(html).toContain(`href="${PRISM_SCAN_HREF.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('data-testid="scan-modal"');
  });

  it("falls back to the pricing self-host band instead of inventing a source URL", () => {
    expect(html).toContain(`href="${SELF_HOST_HREF}"`);
    expect(html).not.toContain("github.com");
    const withSource = render({ ...LINKS, source: "https://example.test/fork" });
    expect(withSource).toContain('href="https://example.test/fork"');
    expect(withSource).toContain('rel="noreferrer"');
  });

  it("labels invented material as illustrative or stylised", () => {
    expect(html).toContain("Illustrative badge: Ascent L3 Augmented");
    expect(html).toMatch(/Stylised: which lines burn/);
    expect(html).toMatch(/Stylised; never a screenshot/);
    expect(html).toContain("tag-ill");
  });

  it("links the legal pages the app footer would have", () => {
    for (const href of ['href="/privacy"', 'href="/terms"', 'href="/leaderboard"', 'href="/pricing"']) {
      expect(html).toContain(href);
    }
  });

  it("the hosted cloud sees the self-host pitch and no setup panel", () => {
    expect(html).toContain("Run it yourself");
    expect(html).not.toContain("Finish setup");
    expect(html).not.toContain("This install");
  });

  it("a self-hosted install with nothing configured is led to /onboarding instead of the pitch", () => {
    const out = render({ ...LINKS, selfHosted: true, setup: "unset" });
    expect(out).toContain("Finish setup");
    expect(out).toContain('href="/onboarding"');
    expect(out).toContain("This install");
    expect(out).not.toContain("Run it yourself");
  });

  it("a configured self-hosted install keeps the panel but drops the finish-setup call to action", () => {
    const out = render({ ...LINKS, selfHosted: true, setup: "ready" });
    expect(out).toContain("This install");
    expect(out).not.toContain("Finish setup");
  });

  it("renders the register section and its nav link only when there is a gallery", () => {
    expect(html).not.toContain('id="register"');
    const card = { fullName: "acme/web", href: "/report/acme/web", level: "L3", levelName: "Managed", overall: 71, dimensions: {}, scannedAt: "2026-08-30T00:00:00Z", verified: true, currentRubric: true, rubricVersion: null, archetype: "org" };
    const gallery = { recent: [card], topAiNative: [card], totalRepos: 1, dbMode: "postgres" } as never;
    const out = renderToStaticMarkup(<PrismLanding links={LINKS} auth={null} gated={false} gallery={gallery} />);
    expect(out).toContain('id="register"');
    expect(out).toContain("acme/web");
    expect(out).toContain('href="#register"');
  });

  it("scopes its symbols so they cannot collide with the app's ids", () => {
    expect(html).toContain('id="prism-mk"');
    expect(html).toContain('id="prism-wm"');
    expect(html).not.toMatch(/\bid="(mk|wm|rdg|qw|qe)"/);
  });
});
