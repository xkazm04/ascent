// A thrown briefing build is not an empty fleet. The page used to render both as
// "Nothing to show yet" / "No scanned repositories", which tells a board the org
// has no data when the read failed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";

const { mockVerify, mockBuildExecBriefing } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockBuildExecBriefing: vi.fn(),
}));

vi.mock("@/lib/briefing-share", () => ({
  verifyBriefingShareToken: mockVerify,
  briefingFigureDigest: () => "stub-digest",
  shareIntegrity: () => "unverifiable" as const,
}));
vi.mock("@/lib/db/org-share", () => ({ briefingShareLinkState: async () => "live" }));
vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuildExecBriefing,
  engineMixLabel: () => "",
  engineMixCaveat: () => null,
  mockDisclosure: () => null,
  valueRealizedHeading: () => "",
  valueRealizedLine: () => null,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgBranding: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
  getTechGroupIdByKey: vi.fn(async () => null),
  getOrgId: vi.fn(async () => null),
  recordAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/members", () => ({
  getMembershipRole: vi.fn(async () => "owner"),
  roleAtLeast: () => true,
}));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));

import SharedBriefingPage from "./page";
import { Notice } from "./shareChrome";

function findNotice(node: unknown): React.ReactElement | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === Notice) return node;
  const children = (node.props as { children?: unknown })?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findNotice(child);
    if (found) return found;
  }
  return null;
}

async function renderPage() {
  return SharedBriefingPage({ params: Promise.resolve({ token: "tok" }) }) as Promise<React.ReactElement>;
}

beforeEach(() => {
  mockVerify.mockReset();
  mockBuildExecBriefing.mockReset();
  mockVerify.mockReturnValue({ org: "acme", range: "90d" });
});

describe("shared briefing when the builder fails", () => {
  it("says the briefing could not be loaded, and logs, instead of claiming the fleet is empty", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBuildExecBriefing.mockRejectedValue(new Error("rollup db exploded"));
    const notice = findNotice(await renderPage());
    expect(notice).not.toBeNull();
    expect(notice!.props.title).toBe("Briefing unavailable");
    expect(notice!.props.body).not.toMatch(/No scanned repositories/);
    expect(spy).toHaveBeenCalledWith("[briefing/share] build failed", "rollup db exploded");
    spy.mockRestore();
  });

  it("keeps the empty-fleet notice when the builder returns null, and stays quiet", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBuildExecBriefing.mockResolvedValue(null);
    const notice = findNotice(await renderPage());
    expect(notice!.props.title).toBe("Nothing to show yet");
    expect(notice!.props.body).toMatch(/No scanned repositories/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
