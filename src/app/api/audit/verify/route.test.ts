// /api/audit/verify — the gate runs before any read, and the response is REPRODUCIBLE: it ships the
// digest recipe and the scope sentence, and it never ships the stored HMAC. A verification only we
// can perform is a claim, not evidence.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(), getOrgId: vi.fn(async () => "org_1"), recordAudit: vi.fn() }));
vi.mock("@/lib/db/control-observations", () => ({ verifySeals: vi.fn(), sealPendingDays: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { GET } from "./route";
import { isDbConfigured, recordAudit } from "@/lib/db";
import { sealPendingDays, verifySeals } from "@/lib/db/control-observations";
import { requireOrgRead } from "@/lib/authz";

const mockIsDb = vi.mocked(isDbConfigured);
const mockVerify = vi.mocked(verifySeals);
const mockSeal = vi.mocked(sealPendingDays);
const mockGate = vi.mocked(requireOrgRead);
const mockAudit = vi.mocked(recordAudit);

const get = (qs: string) => GET(new Request(`http://localhost/api/audit/verify${qs}`));

const chain = (over: Partial<NonNullable<Awaited<ReturnType<typeof verifySeals>>>> = {}) => ({
  checks: [
    {
      day: "2026-08-21",
      rowCount: 2,
      root: "root-a",
      prevRoot: null,
      sealedAt: "2026-08-22T00:00:00.000Z",
      signed: true,
      verdict: "ok" as const,
      recomputedRoot: "root-a",
      rowsNow: 2,
    },
  ],
  chainOk: true,
  unsealedDays: ["2026-08-22"],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDb.mockReturnValue(true);
  mockGate.mockResolvedValue(null);
  mockSeal.mockResolvedValue([]);
  mockVerify.mockResolvedValue(chain());
});

describe("gating", () => {
  it("503s without a database, before the gate", async () => {
    mockIsDb.mockReturnValue(false);
    expect((await get("?org=acme")).status).toBe(503);
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("400s without an org", async () => {
    expect((await get("")).status).toBe(400);
  });

  it("returns the denial verbatim and neither seals nor verifies", async () => {
    const denial = new Response(JSON.stringify({ error: "denied" }), { status: 403 });
    mockGate.mockResolvedValue(denial);
    expect(await get("?org=acme")).toBe(denial);
    expect(mockSeal).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });
});

describe("the verdict", () => {
  it("chainOk true on an untouched ledger", async () => {
    expect((await (await get("?org=acme")).json()).chainOk).toBe(true);
  });

  it("chainOk false once a day is tampered", async () => {
    mockVerify.mockResolvedValue(
      chain({ chainOk: false, checks: [{ ...chain().checks[0]!, verdict: "tampered", recomputedRoot: "other", rowsNow: 1 }] }),
    );
    const body = await (await get("?org=acme")).json();
    expect(body.chainOk).toBe(false);
    expect(body.seals[0].verdict).toBe("tampered");
    // The seal still states what WAS there — that is what makes the deletion visible.
    expect(body.seals[0].rowCount).toBe(2);
    expect(body.seals[0].rowsNow).toBe(1);
  });
});

describe("reproducibility", () => {
  it("ships the digest recipe so an examiner can repeat the check without our secret", async () => {
    const body = await (await get("?org=acme")).json();
    expect(body.recipe.rowDigest).toContain("sha256");
    expect(body.recipe.dayRoot).toContain("sorted");
    expect(body.recipe.limits).toContain("do not");
  });

  it("NEVER ships the stored HMAC — only whether one exists", async () => {
    const body = await (await get("?org=acme")).json();
    expect(body.seals[0].signed).toBe(true);
    // The boolean, and only the boolean: no `sig` key anywhere in the payload.
    expect(Object.keys(body.seals[0])).not.toContain("sig");
    expect(JSON.stringify(body)).not.toContain('"sig"');
  });

  it("states what chainOk does and does not cover", async () => {
    expect((await (await get("?org=acme")).json()).scope).toContain("no-rows");
  });

  it("names the days it sealed on THIS request, so a fresh seal is not read as a standing one", async () => {
    mockSeal.mockResolvedValue(["2026-08-20"]);
    expect((await (await get("?org=acme")).json()).sealedOnThisRequest).toEqual(["2026-08-20"]);
  });
});

describe("audit", () => {
  it("records controls.verify with the days it judged and the ones that failed", async () => {
    mockVerify.mockResolvedValue(
      chain({ chainOk: false, checks: [{ ...chain().checks[0]!, verdict: "broken-chain" }] }),
    );
    await get("?org=acme&from=2026-08-01&to=2026-08-31");
    expect(mockAudit).toHaveBeenCalledWith(
      "controls.verify",
      expect.objectContaining({ chainOk: false, days: 1, tampered: ["2026-08-21"], from: "2026-08-01" }),
      expect.objectContaining({ orgId: "org_1" }),
    );
  });
});
