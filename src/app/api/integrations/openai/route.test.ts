// Pins the OpenAI admin-key custody endpoint. The properties that matter more than status codes:
// writes are owner-only and same-origin, the key is refused when it cannot be encrypted, and NO
// response (GET, PUT or DELETE) ever contains the key.
//
// The db module runs for REAL against an in-memory providerCredential store, with a real
// ENCRYPTION_KEY, so "the response never contains the key" is tested against a row that actually
// holds its ciphertext.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: { rows: [] as Record<string, unknown>[] } }));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    providerCredential: {
      findFirst: async ({ where }: { where: { orgId: string } }) => store.rows.find((r) => r.orgId === where.orgId) ?? null,
      upsert: async ({ where, update, create }: { where: { orgId_provider: { orgId: string } }; update: object; create: object }) => {
        const now = new Date("2026-09-24T10:00:00Z");
        const row = store.rows.find((r) => r.orgId === where.orgId_provider.orgId);
        if (row) return Object.assign(row, update, { updatedAt: now });
        const made = { credentialRef: null, projectIdsJson: null, lastSyncAt: null, lastSyncStatus: null, lastSyncDetail: null,
          lastSyncFrom: null, lastSyncThrough: null, ...create, updatedAt: now };
        store.rows.push(made);
        return made;
      },
      deleteMany: async ({ where }: { where: { orgId: string } }) => {
        const n = store.rows.length;
        store.rows = store.rows.filter((r) => r.orgId !== where.orgId);
        return { count: n - store.rows.length };
      },
    },
  }),
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async () => "org_1" }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octo") }));

import { DELETE, GET, PUT } from "./route";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { recordAudit } from "@/lib/db/scans-audit";

const KEY = "sk-admin-CUSTODY-TEST-0123456789abcdef";
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const mockRole = vi.mocked(requireOrgRole);
const mockOrigin = vi.mocked(requireSameOrigin);

function req(method: string, body?: unknown, qs = ""): Request {
  return new Request(`http://localhost/api/integrations/openai${qs}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  store.rows = [];
  vi.clearAllMocks();
  mockRole.mockResolvedValue(null);
  mockOrigin.mockReturnValue(null);
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("the admin key is write-only over HTTP", () => {
  it("PUT stores it and answers hasCredential, not the key", async () => {
    const res = await PUT(req("PUT", { org: "acme", adminKey: KEY, projectIds: ["proj_codex"] }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).connection).toMatchObject({ hasCredential: true, projectIds: ["proj_codex"] });
    expect(String(store.rows[0]!.credentialRef)).not.toContain(KEY);
  });

  it("GET status never contains the key or its ciphertext", async () => {
    await PUT(req("PUT", { org: "acme", adminKey: KEY }));
    const res = await GET(req("GET", undefined, "?org=acme"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(String(store.rows[0]!.credentialRef));
    expect(JSON.parse(text)).toMatchObject({ connection: { hasCredential: true }, encryptionConfigured: true });
  });

  it("the audit rows never carry the key", async () => {
    await PUT(req("PUT", { org: "acme", adminKey: KEY }));
    await DELETE(req("DELETE", { org: "acme" }));
    expect(vi.mocked(recordAudit).mock.calls.map((c) => c[0])).toEqual(["integrations.openai.connect", "integrations.openai.disconnect"]);
    expect(JSON.stringify(vi.mocked(recordAudit).mock.calls)).not.toContain(KEY);
  });
});

describe("owner-only, same-origin writes", () => {
  it("every verb asks for the OWNER role", async () => {
    await GET(req("GET", undefined, "?org=acme"));
    await PUT(req("PUT", { org: "acme", adminKey: KEY }));
    await DELETE(req("DELETE", { org: "acme" }));
    expect(mockRole.mock.calls).toEqual([["acme", "owner"], ["acme", "owner"], ["acme", "owner"]]);
  });

  it("a refused role stores nothing", async () => {
    mockRole.mockResolvedValue(new Response("{}", { status: 403 }) as never);
    expect((await PUT(req("PUT", { org: "acme", adminKey: KEY }))).status).toBe(403);
    expect(store.rows).toHaveLength(0);
  });

  it("a cross-origin write is refused before the role check", async () => {
    mockOrigin.mockReturnValue(new Response("{}", { status: 403 }) as never);
    expect((await PUT(req("PUT", { org: "acme", adminKey: KEY }))).status).toBe(403);
    expect((await DELETE(req("DELETE", { org: "acme" }))).status).toBe(403);
    expect(mockRole).not.toHaveBeenCalled();
  });
});

describe("validation and fail-closed custody", () => {
  it("409s a key when ENCRYPTION_KEY is not configured, storing nothing", async () => {
    delete process.env.ENCRYPTION_KEY;
    const res = await PUT(req("PUT", { org: "acme", adminKey: KEY }));
    expect(res.status).toBe(409);
    expect(store.rows).toHaveLength(0);
  });

  it.each([
    ["a project key", "sk-proj-abcdefghijklmnopqrstuvwxyz"],
    ["whitespace", "sk-admin-abc def ghi jkl mno"],
    ["too short", "sk-admin-x"],
  ])("400s %s without echoing it", async (_label, bad) => {
    const res = await PUT(req("PUT", { org: "acme", adminKey: bad }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(bad);
  });

  it("400s a malformed project id", async () => {
    expect((await PUT(req("PUT", { org: "acme", adminKey: KEY, projectIds: ["../etc"] }))).status).toBe(400);
  });

  it("400s a first connect with no key", async () => {
    expect((await PUT(req("PUT", { org: "acme", projectIds: [] }))).status).toBe(400);
  });

  it("DELETE removes the stored key", async () => {
    await PUT(req("PUT", { org: "acme", adminKey: KEY }));
    const res = await DELETE(req("DELETE", { org: "acme" }));
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(store.rows).toHaveLength(0);
  });
});
