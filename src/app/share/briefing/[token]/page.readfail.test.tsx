// robustness-4: a FAILED read on the share page fails closed but is not relabelled as a fact about the
// sharer or the scope ("no longer has access" / "no longer exists"); a read that RETURNED none still is.
// The failure is logged and reported. Real codec; the db boundary is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";

const { mockBuild, report, h } = vi.hoisted(() => ({
  mockBuild: vi.fn(),
  report: vi.fn(),
  h: { roleFail: false, role: "owner" as string | null, stackFail: false, stackId: null as string | null },
}));

vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuild, engineMixLabel: () => "", engineMixCaveat: () => null,
  mockDisclosure: () => null, valueRealizedHeading: () => "", valueRealizedLine: () => null,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgBranding: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
  getTechGroupIdByKey: vi.fn(async () => {
    if (h.stackFail) throw new Error("db down");
    return h.stackId;
  }),
  getOrgId: vi.fn(async () => null),
  recordAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/org-share", () => ({ briefingShareLinkState: async () => "live" }));
vi.mock("@/lib/db/members", () => ({
  getMembershipRole: vi.fn(async () => {
    if (h.roleFail) throw new Error("db down");
    return h.role;
  }),
  roleAtLeast: (r: string | null, min: string) => r === min,
}));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));

import SharedBriefingPage from "./page";
import { Notice } from "./shareChrome";
import { signBriefingShareToken } from "@/lib/briefing-share";

function findNotice(node: unknown): React.ReactElement | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === Notice) return node;
  const children = (node.props as { children?: unknown })?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findNotice(child);
    if (found) return found;
  }
  return null;
}
const open = async (token: string) => findNotice(await SharedBriefingPage({ params: Promise.resolve({ token }) }));
const mint = (over: Record<string, unknown> = {}) => signBriefingShareToken({ org: "acme", range: "30d", ...over })!.token;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.BRIEFING_SHARE_SECRET;
  process.env.BRIEFING_SHARE_SECRET = "readfail-secret";
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mockBuild.mockResolvedValue(null);
  Object.assign(h, { roleFail: false, role: "owner", stackFail: false, stackId: null });
});
afterEach(() => {
  if (saved === undefined) delete process.env.BRIEFING_SHARE_SECRET;
  else process.env.BRIEFING_SHARE_SECRET = saved;
});

describe("share page: failed read vs read that returned none", () => {
  it("a minter-role read that THROWS asks to try again and does not say the sharer lost access", async () => {
    h.roleFail = true;
    const notice = await open(mint({ mintedBy: "o" }));
    expect(notice!.props.title).toBe("Briefing unavailable");
    expect(String(notice!.props.body)).toMatch(/try it again/i);
    expect(String(notice!.props.body)).not.toMatch(/no longer has access/);
    expect(report).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("a minter-role read that returns a non-owner still says the sharer lost access (and reports nothing)", async () => {
    h.role = "member";
    const notice = await open(mint({ mintedBy: "o" }));
    expect(String(notice!.props.body)).toContain("no longer has access");
    expect(report).not.toHaveBeenCalled();
  });

  it("a stack-scope read that THROWS asks to try again and does not say the scope is gone", async () => {
    h.stackFail = true;
    const notice = await open(mint({ stack: "frontend" }));
    expect(notice!.props.title).toBe("Briefing unavailable");
    expect(String(notice!.props.body)).not.toMatch(/no longer exists/);
    expect(report).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("a stack key that resolves to none still says the scope no longer exists", async () => {
    const notice = await open(mint({ stack: "frontend" }));
    expect(String(notice!.props.body)).toContain("no longer exists");
    expect(report).not.toHaveBeenCalled();
  });
});
