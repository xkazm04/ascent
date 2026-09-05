// The low-balance preference endpoint: it PERSISTS (in `Organization.autoRechargeJson`, a real column
// since G1-39) and it ROUND-TRIPS.
//
// The store is faked at the `@/lib/db/org-settings` boundary with an in-memory per-org column, and the
// audit sink is faked separately at `@/lib/db`. Splitting them is the point: the audit row used to BE
// the storage, and these tests now pin that it is no longer load-bearing — a save succeeds on the
// column write, the audit row is written alongside it as a record of the change, and losing the audit
// row does NOT fail (or undo) a preference the customer's column already holds.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

/** In-memory stand-in for the AuditLog table (newest first, like getAuditLog's ordering). */
const auditRows: { org: string; action: string; meta: Record<string, unknown> }[] = [];
let auditWriteOk = true;

vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  recordOrgAudit: vi.fn(async (action: string, org: string, meta: Record<string, unknown>) => {
    if (!auditWriteOk) return false;
    // The real writer folds an integrity signature into meta — mirror that, so nothing downstream is
    // ever proven only against a pristine preference object.
    auditRows.unshift({ org, action, meta: { ...meta, _sig: "sig" } });
    return true;
  }),
}));

/** In-memory stand-in for `Organization.autoRechargeJson`, keyed by org slug. */
const prefColumn = new Map<string, { enabled: boolean; threshold: number; packProductId: string | null }>();
let columnWriteOk = true;

vi.mock("@/lib/db/org-settings", () => ({
  getOrgAutoRecharge: vi.fn(async (org: string) => {
    const stored = prefColumn.get(org);
    return stored
      ? { pref: stored, source: "column" }
      : { pref: { enabled: false, threshold: 5, packProductId: null }, source: "default" };
  }),
  setOrgAutoRecharge: vi.fn(async (org: string, pref: { enabled: boolean; threshold: number; packProductId: string | null }) => {
    if (!columnWriteOk) return false;
    prefColumn.set(org, pref);
    return true;
  }),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgRead: vi.fn(async () => null),
  requireOrgRole: vi.fn(async () => null),
}));
vi.mock("@/lib/auth", () => ({ isSameOrigin: vi.fn(() => true) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "owner-login") }));

import { GET, PUT } from "./route";
import { recordOrgAudit } from "@/lib/db";
import { setOrgAutoRecharge } from "@/lib/db/org-settings";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
import { AUTO_RECHARGE_ACTION } from "@/components/org/shared/CreditsControl.autorecharge";

function getReq(org = "acme") {
  return new Request(`http://localhost/api/billing/autorecharge?org=${org}`);
}
function putReq(body: unknown) {
  return new Request("http://localhost/api/billing/autorecharge", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auditRows.length = 0;
  auditWriteOk = true;
  prefColumn.clear();
  columnWriteOk = true;
  vi.mocked(requireOrgRole).mockResolvedValue(null);
  vi.mocked(isSameOrigin).mockReturnValue(true);
});

describe("GET — before anything is stored", () => {
  it("answers with the default, which is OFF (no org is opted in implicitly)", async () => {
    const body = await (await GET(getReq())).json();
    expect(body.source).toBe("default");
    expect(body.pref).toEqual({ enabled: false, threshold: 5, packProductId: null });
  });

  it("states plainly that nothing charges automatically", async () => {
    const body = await (await GET(getReq())).json();
    expect(body.chargesAutomatically).toBe(false);
  });

  it("400s without ?org", async () => {
    const res = await GET(new Request("http://localhost/api/billing/autorecharge"));
    expect(res.status).toBe(400);
  });
});

describe("PUT → GET round-trip (the persistence proof)", () => {
  it("stores the preference and reads back exactly what was saved", async () => {
    const res = await PUT(putReq({ org: "acme", enabled: true, threshold: 25, packProductId: "prod_500" }));
    expect(res.status ?? 200).toBe(200);
    const saved = await res.json();
    expect(saved.pref).toEqual({ enabled: true, threshold: 25, packProductId: "prod_500" });
    expect(recordOrgAudit).toHaveBeenCalledWith(AUTO_RECHARGE_ACTION, "acme", expect.anything(), "owner-login");

    // A FRESH read (new request, nothing cached) returns the stored value, not the default.
    const read = await (await GET(getReq())).json();
    expect(read.source).toBe("stored");
    expect(read.pref).toEqual({ enabled: true, threshold: 25, packProductId: "prod_500" });
  });

  it("writes the preference to the COLUMN, and the audit row alongside it as a record of the change", async () => {
    await PUT(putReq({ org: "acme", enabled: true, threshold: 25, packProductId: "prod_500" }));
    // The save landed in real storage — not in the audit trail, which a retention purge may delete.
    expect(setOrgAutoRecharge).toHaveBeenCalledWith("acme", {
      enabled: true,
      threshold: 25,
      packProductId: "prod_500",
    });
    // …and the audit row is still written, because "who changed this billing setting, and when" is a
    // genuine audit event. It is just no longer the storage.
    expect(auditRows[0]).toMatchObject({ org: "acme", action: AUTO_RECHARGE_ACTION });
  });

  it("a failed AUDIT write no longer fails the save — the customer's setting is already persisted", async () => {
    // Under the old arrangement this was a 503, because the audit row WAS the storage. Reporting a
    // failure now would be a lie in the other direction: the preference is durably saved.
    auditWriteOk = false;
    const res = await PUT(putReq({ org: "acme", enabled: true, threshold: 25 }));
    expect(res.status ?? 200).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect((await (await GET(getReq())).json()).pref.threshold).toBe(25);
  });

  it("the LATEST write wins — a re-save overwrites the column rather than appending", async () => {
    await PUT(putReq({ org: "acme", enabled: true, threshold: 25 }));
    await PUT(putReq({ org: "acme", enabled: true, threshold: 3 }));
    const read = await (await GET(getReq())).json();
    expect(read.pref.threshold).toBe(3);
  });

  it("turning the feature back OFF persists as OFF (not as an absent preference)", async () => {
    await PUT(putReq({ org: "acme", enabled: true, threshold: 25 }));
    await PUT(putReq({ org: "acme", enabled: false, threshold: 25 }));
    const read = await (await GET(getReq())).json();
    expect(read.source).toBe("stored");
    expect(read.pref.enabled).toBe(false);
  });

  it("is scoped per org — one org's preference never leaks into another's read", async () => {
    await PUT(putReq({ org: "acme", enabled: true, threshold: 25 }));
    const other = await (await GET(getReq("globex"))).json();
    expect(other.source).toBe("default");
    expect(other.pref.enabled).toBe(false);
  });
});

describe("PUT guards", () => {
  it("rejects a cross-origin write (CSRF defense on a billing-adjacent mutation)", async () => {
    vi.mocked(isSameOrigin).mockReturnValue(false);
    expect((await PUT(putReq({ org: "acme", enabled: true, threshold: 5 }))).status).toBe(403);
    expect(recordOrgAudit).not.toHaveBeenCalled();
  });

  it("is owner-gated — a non-owner's denial short-circuits before any write", async () => {
    vi.mocked(requireOrgRole).mockResolvedValue(new Response("nope", { status: 403 }) as never);
    expect((await PUT(putReq({ org: "acme", enabled: true, threshold: 5 }))).status).toBe(403);
    expect(recordOrgAudit).not.toHaveBeenCalled();
  });

  it("400s an out-of-range threshold instead of silently clamping it", async () => {
    for (const threshold of [0, -5, 2.5, 999_999, "5"]) {
      const res = await PUT(putReq({ org: "acme", enabled: true, threshold }));
      expect(res.status).toBe(400);
    }
    expect(recordOrgAudit).not.toHaveBeenCalled();
  });

  it("does NOT validate the threshold when disabling — turning it off must always be possible", async () => {
    const res = await PUT(putReq({ org: "acme", enabled: false }));
    expect(res.status ?? 200).toBe(200);
  });

  it("reports a failed STORE as a failed SAVE, never as success", async () => {
    columnWriteOk = false;
    const res = await PUT(putReq({ org: "acme", enabled: true, threshold: 5 }));
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBeUndefined();
  });

  it("400s without an org", async () => {
    expect((await PUT(putReq({ enabled: true, threshold: 5 }))).status).toBe(400);
  });
});
