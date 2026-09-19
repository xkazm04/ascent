// Pins /launch's "Enter mission control" destination. OAuth lands here with no ?next=, and the
// CTA used to carry safeNext's /onboarding default even when the viewer already has a fleet.

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  resolveSignInState: vi.fn(),
  viewerInstallations: vi.fn(),
  viewerDisplayName: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("@/lib/signin-gate", () => ({ resolveSignInState: h.resolveSignInState }));
vi.mock("@/lib/viewer-installations", () => ({
  viewerInstallations: h.viewerInstallations,
  viewerDisplayName: h.viewerDisplayName,
}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import LaunchPage from "./page";

function fleetMapNext(node: ReactNode): string | undefined {
  if (node == null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = fleetMapNext(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const el = node as ReactElement<{
    next?: string;
    installations?: { login: string }[];
    children?: ReactNode;
  }>;
  if (typeof el.props.next === "string" && Array.isArray(el.props.installations)) {
    return el.props.next;
  }
  return fleetMapNext(el.props.children);
}

async function launch(next?: string) {
  return LaunchPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
}

describe("/launch Enter mission control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.resolveSignInState.mockResolvedValue({
      needsSignIn: false,
      provider: "github",
      expired: false,
      session: null,
    });
    h.viewerDisplayName.mockResolvedValue("Ada");
    h.viewerInstallations.mockResolvedValue([
      { id: 1, login: "acme" },
      { id: 2, login: "globex" },
    ]);
  });

  it("sends the CTA to the first org dashboard when nextParam is absent", async () => {
    expect(fleetMapNext(await launch())).toBe("/org/acme");
  });

  it("treats the /onboarding default as no destination when the viewer has a fleet", async () => {
    expect(fleetMapNext(await launch("/onboarding"))).toBe("/org/acme");
  });

  it("lets an explicit safe ?next= win", async () => {
    expect(fleetMapNext(await launch("/org/globex"))).toBe("/org/globex");
  });

  it("still redirects an empty fleet to /onboarding", async () => {
    h.viewerInstallations.mockResolvedValue([]);
    await expect(launch()).rejects.toThrow("REDIRECT:/onboarding");
  });
});
