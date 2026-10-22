// The landing's live-gallery read degrades AND reaches a door (src/app/page.tsx:113).
//
// `getPublicScanGallery().catch(degradeTo("landing: getPublicScanGallery", null))` — when the gallery
// read rejects, the landing must still render (a broken DB can never fail the front page) with NO live
// examples: the landing falls back to its static ones. What was a silent swallow is now a door: a
// console.warn naming the read plus reportHandledError telemetry. A healthy read reaches no door and
// hands the top three AI-native repos down as the examples.
//
// The page is an async SERVER component: it is awaited and its returned element tree is walked for the
// landing element's props — no DOM needed. The landings and site chrome are stubs; this page owns the
// read and the props, not their rendering.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ReactElement, ReactNode } from "react";

const h = vi.hoisted(() => ({
  getPublicScanGallery: vi.fn(),
  recordQuotaEvent: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  getPublicScanGallery: h.getPublicScanGallery,
  recordQuotaEvent: h.recordQuotaEvent,
}));
// server-only + cookies/headers: not what this page owns.
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false }));
// Pulls the rate limiter / entitlement / credit ledger through @/lib/db; the wall predicate is all we need.
vi.mock("@/lib/scan-gates", () => ({ publicScanWallEnabled: () => false }));
vi.mock("@/components/Brand", () => ({ SiteHeader: () => null, SiteFooter: () => null }));
vi.mock("@/components/landing/prism/PrismLanding", () => ({ PrismLanding: vi.fn(() => null) }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import Home from "./page";
import { PrismLanding } from "@/components/landing/prism/PrismLanding";
import { reportHandledError } from "@/lib/api/respond";

type Props = Record<string, unknown>;

/** Depth-first search of a returned element tree for the element whose type is `component`. */
function findProps(node: ReactNode, component: unknown): Props | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findProps(child, component);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const el = node as ReactElement<Props & { children?: ReactNode }>;
  if (el.type === component) return el.props;
  return findProps(el.props.children, component);
}

async function render() {
  return Home();
}

const card = (fullName: string) => ({ fullName });
const GALLERY = {
  recent: [card("acme/recent")],
  topAiNative: [card("acme/a"), card("acme/b"), card("acme/c"), card("acme/d")],
  totalRepos: 4,
};

let warn: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("landing (/) — getPublicScanGallery failure reaches a door", () => {
  it("a rejected gallery read still renders the landing with no live examples", async () => {
    h.getPublicScanGallery.mockRejectedValue(new Error("db unreachable"));
    const tree = await render();
    const props = findProps(tree, PrismLanding);
    expect(props).not.toBeNull();
    expect(props!.exampleRepos).toBeUndefined();
  });

  it("the failure is reported: console.warn names the read and telemetry is called", async () => {
    const boom = new Error("db unreachable");
    h.getPublicScanGallery.mockRejectedValue(boom);
    await render();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("landing: getPublicScanGallery"))).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ message: expect.stringContaining("getPublicScanGallery") }),
    );
  });

  it("control: a healthy read passes the top three AI-native repos down and reaches no door", async () => {
    h.getPublicScanGallery.mockResolvedValue(GALLERY);
    const props = findProps(await render(), PrismLanding);
    expect(props!.exampleRepos).toEqual(["acme/a", "acme/b", "acme/c"]);
    expect(reportHandledError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("control: an empty store (null gallery, no error) is not a failure — no door", async () => {
    h.getPublicScanGallery.mockResolvedValue(null);
    const props = findProps(await render(), PrismLanding);
    expect(props!.exampleRepos).toBeUndefined();
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});
