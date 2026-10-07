// The outsider-facing share page's refusal branches, driven with REAL tokens (the real codec, the real
// revocation lookup over an in-memory ledger) rather than a stubbed verify: a bad signature, an expired
// token, a revoked grant, a minter who is no longer an owner, an unreadable ledger (fails closed), and a
// revocation written by ANOTHER org (which must not touch this org's link). Every refusal must stop
// before the briefing is built; "Nothing to show yet" (a null build) stands for "got past every gate".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";

const { mockBuild, ledger, sessions, role } = vi.hoisted(() => ({
  mockBuild: vi.fn(),
  ledger: new Map<string, number>(),
  sessions: { fail: false },
  role: { value: "owner" as string | null },
}));

vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuild,
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
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => ({}) }));
vi.mock("@/lib/db/scans-audit", () => ({ getAuditLog: vi.fn(async () => null) }));
vi.mock("@/lib/db/sessions", () => ({
  getSessionVersion: async (k: string) => {
    if (sessions.fail) throw new Error("ledger unreachable");
    return ledger.get(k.toLowerCase()) ?? 0;
  },
  bumpSessionVersion: async (k: string) => {
    ledger.set(k.toLowerCase(), (ledger.get(k.toLowerCase()) ?? 0) + 1);
    return 1;
  },
}));
vi.mock("@/lib/db/members", () => ({
  getMembershipRole: vi.fn(async () => role.value),
  roleAtLeast: (r: string | null, min: string) => r === min || (min === "member" && r === "owner"),
}));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));

import SharedBriefingPage from "./page";
import { Notice } from "./shareChrome";
import { signBriefingShareToken } from "@/lib/briefing-share";
import { revokeBriefingShareLink } from "@/lib/db/org-share";
import { signShareToken } from "@/lib/signed-share";

const SECRET = "refusal-test-secret";

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
const mint = (over: Record<string, unknown> = {}) => signBriefingShareToken({ org: "acme", range: "30d", ...over })!;

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.BRIEFING_SHARE_SECRET;
  process.env.BRIEFING_SHARE_SECRET = SECRET;
  mockBuild.mockReset();
  mockBuild.mockResolvedValue(null);
  ledger.clear();
  sessions.fail = false;
  role.value = "owner";
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.BRIEFING_SHARE_SECRET;
  else process.env.BRIEFING_SHARE_SECRET = savedSecret;
});

describe("share page: refusal branches", () => {
  it("opens a valid token (control: reaches the build)", async () => {
    expect((await open(mint({ mintedBy: "owner-a" }).token))!.props.title).toBe("Nothing to show yet");
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });

  it("refuses a flipped signature", async () => {
    const { token } = mint();
    const bad = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect((await open(bad))!.props.title).toBe("Link expired or invalid");
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("refuses a payload edited under the original signature (org swapped)", async () => {
    const { token } = mint();
    const [payload, sig] = token.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    edited.org = "victim-org";
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${sig}`;
    expect((await open(forged))!.props.title).toBe("Link expired or invalid");
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("refuses an expired token", async () => {
    const expired = signShareToken({ org: "acme", range: "30d", exp: Date.now() - 1000 }, SECRET);
    expect((await open(expired))!.props.title).toBe("Link expired or invalid");
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("refuses a revoked grant, and only that grant", async () => {
    const dead = mint();
    const live = mint();
    await revokeBriefingShareLink("acme", dead.jti!);
    expect((await open(dead.token))!.props.title).toBe("Link revoked");
    expect(mockBuild).not.toHaveBeenCalled();
    expect((await open(live.token))!.props.title).toBe("Nothing to show yet");
  });

  it("another org's revocation of the same jti does not kill this org's link", async () => {
    const link = mint();
    await revokeBriefingShareLink("other-org", link.jti!);
    expect((await open(link.token))!.props.title).toBe("Nothing to show yet");
  });

  it("still refuses a link revoked under the legacy unscoped key", async () => {
    const link = mint();
    ledger.set(`briefing-share:${link.jti}`, 1);
    expect((await open(link.token))!.props.title).toBe("Link revoked");
  });

  it("refuses when the minter is no longer an owner", async () => {
    role.value = "member";
    const notice = await open(mint({ mintedBy: "ex-owner" }).token);
    expect(notice!.props.title).toBe("Link revoked");
    expect(String(notice!.props.body)).toContain("no longer has access");
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("fails closed when the revocation ledger is unreadable, without calling the link revoked", async () => {
    sessions.fail = true;
    const notice = await open(mint().token);
    expect(notice!.props.title).toBe("Briefing unavailable");
    expect(String(notice!.props.body)).not.toMatch(/revoked/i);
    expect(mockBuild).not.toHaveBeenCalled();
  });
});
