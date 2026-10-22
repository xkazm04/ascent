// POST /api/org/followups/claims (followups-1): the human claim verbs, gate-then-constrain.
//
// The data layer is mocked here; its compare-and-set and event/audit shape are pinned against a fake
// Prisma in src/lib/db/followup-claims-human.test.ts. What this file pins is the door: the org gate,
// the admin escalation the model asks for, whole-request tenancy, the public-org refusal and the cap.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/auth", async () => ({ PUBLIC_ORG: (await import("@/lib/org-constants")).PUBLIC_ORG }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "bo") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgAdmin: vi.fn(async () => null) }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: vi.fn(() => null) }));
vi.mock("@/lib/db/followup-claims-human", () => ({
  readClaimStates: vi.fn(),
  takeOverEscalations: vi.fn(),
  sendBack: vi.fn(),
  releaseHumanClaims: vi.fn(),
}));

import { POST } from "./route";
import { requireOrgAccess, requireOrgAdmin } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { readClaimStates, releaseHumanClaims, sendBack, takeOverEscalations } from "@/lib/db/followup-claims-human";
import { PUBLIC_ORG } from "@/lib/org-constants";

const mockAccess = vi.mocked(requireOrgAccess);
const mockAdmin = vi.mocked(requireOrgAdmin);
const mockLogin = vi.mocked(resolveViewerLogin);
const mockRead = vi.mocked(readClaimStates);
const mockRelease = vi.mocked(releaseHumanClaims);
const mockSendBack = vi.mocked(sendBack);
const mockTake = vi.mocked(takeOverEscalations);

const post = (body: unknown) => POST(new Request("http://x/api/org/followups/claims", { method: "POST", body: JSON.stringify(body) }));
const forbidden = () => Response.json({ error: "Admins only." }, { status: 403 }) as never;

const anaHandoff = { id: "rec-ana", status: "in_progress" as const, claimActor: "ana", claimExecutor: "human" as const, leaseUntil: null, needsHuman: false };
const escalation = { id: "rec-esc", status: "in_progress" as const, claimActor: "agent:tok_A", claimExecutor: "remote-agent" as const, leaseUntil: null, needsHuman: true };
const noWrites = () => {
  expect(mockRelease).not.toHaveBeenCalled();
  expect(mockSendBack).not.toHaveBeenCalled();
  expect(mockTake).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null);
  mockAdmin.mockResolvedValue(null);
  mockLogin.mockResolvedValue("bo");
  mockRead.mockImplementation(async (_org, ids) => [anaHandoff, escalation].filter((s) => ids.includes(s.id)));
  mockRelease.mockImplementation(async (_o, ids) => ({ done: [...ids], skipped: [] }));
  mockSendBack.mockImplementation(async (_o, ids) => ({ done: [...ids], skipped: [] }));
  mockTake.mockImplementation(async (_o, ids) => ({ done: [...ids], skipped: [] }));
});

describe("POST /api/org/followups/claims", () => {
  it("a member releasing another person's hand-off is escalated to the admin gate and refused with no write", async () => {
    mockAdmin.mockResolvedValue(forbidden());
    const res = await post({ org: "acme", action: "release", ids: ["rec-ana"] });
    expect(res.status).toBe(403);
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockAdmin).toHaveBeenCalledWith("acme", "admin");
    noWrites();
  });

  it("an admin releases it: 200 with the released ids, written as an admin", async () => {
    const res = await post({ org: "acme", action: "release", ids: ["rec-ana"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ released: ["rec-ana"], skipped: [] });
    expect(mockRelease).toHaveBeenCalledWith("acme", ["rec-ana"], { login: "bo", admin: true });
  });

  it("the holder releases their own hand-off without the admin gate", async () => {
    mockLogin.mockResolvedValue("ana");
    const res = await post({ org: "acme", action: "release", ids: ["rec-ana"] });
    expect(res.status).toBe(200);
    expect(mockAdmin).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith("acme", ["rec-ana"], { login: "ana", admin: false });
  });

  it("a member takes over an escalation without the admin gate", async () => {
    const res = await post({ org: "acme", action: "take-over", ids: ["rec-esc"] });
    expect(await res.json()).toEqual({ taken: ["rec-esc"], skipped: [] });
    expect(mockAdmin).not.toHaveBeenCalled();
    expect(mockTake).toHaveBeenCalledWith("acme", ["rec-esc"], "bo");
  });

  it("an id from another org is a whole-request 403 with the same body as an unknown id", async () => {
    const foreign = await post({ org: "acme", action: "send-back", ids: ["rec-esc", "rec-other-org"] });
    const unknown = await post({ org: "acme", action: "send-back", ids: ["rec-esc", "no-such-id"] });
    expect(foreign.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await foreign.json()).toEqual(await unknown.json());
    noWrites();
  });

  it("refuses the public org before any gate or read", async () => {
    const res = await post({ org: PUBLIC_ORG, action: "take-over", ids: ["rec-esc"] });
    expect(res.status).toBe(403);
    expect(mockRead).not.toHaveBeenCalled();
    noWrites();
  });

  it("51 ids is a 400 naming the cap of 50", async () => {
    const res = await post({ org: "acme", action: "send-back", ids: Array.from({ length: 51 }, (_, i) => `r${i}`) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("50");
    noWrites();
  });

  it("an unknown action or missing org is a 400, and every error sentence avoids an em dash", async () => {
    const bad = await post({ org: "acme", action: "steal", ids: ["rec-esc"] });
    expect(bad.status).toBe(400);
    expect((await post({ action: "release", ids: ["rec-esc"] })).status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toContain(String.fromCharCode(0x2014));
    noWrites();
  });

  it("a member's access denial wins before anything is read", async () => {
    mockAccess.mockResolvedValue(forbidden());
    expect((await post({ org: "acme", action: "take-over", ids: ["rec-esc"] })).status).toBe(403);
    expect(mockRead).not.toHaveBeenCalled();
  });
});
