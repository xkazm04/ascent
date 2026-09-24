// @vitest-environment node
//
// The stored OpenAI admin key: encrypted at rest with ENCRYPTION_KEY (secret-box, the same scheme the
// forge installations and BYOM use), readable only through `getProviderSecret`, and ABSENT from every
// row a route can serialize. The in-memory store below holds exactly what Prisma would, so "the
// ciphertext is what is stored" is asserted against the stored value, not assumed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, mockAudit } = vi.hoisted(() => ({
  store: { rows: [] as Record<string, unknown>[] },
  mockAudit: vi.fn(async () => true),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    providerCredential: {
      findFirst: vi.fn(async ({ where }: { where: { orgId: string; provider: string } }) =>
        store.rows.find((r) => r.orgId === where.orgId && r.provider === where.provider) ?? null),
      upsert: vi.fn(async ({ where, update, create }: {
        where: { orgId_provider: { orgId: string; provider: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const k = where.orgId_provider;
        const row = store.rows.find((r) => r.orgId === k.orgId && r.provider === k.provider);
        const now = new Date("2026-09-24T10:00:00Z");
        if (row) return Object.assign(row, update, { updatedAt: now });
        const made = { id: "pc_1", credentialRef: null, projectIdsJson: null, lastSyncAt: null, lastSyncStatus: null,
          lastSyncDetail: null, lastSyncFrom: null, lastSyncThrough: null, ...create, createdAt: now, updatedAt: now };
        store.rows.push(made);
        return made;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { orgId: string; provider: string }; data: Record<string, unknown> }) => {
        const hit = store.rows.filter((r) => r.orgId === where.orgId && r.provider === where.provider);
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { orgId: string; provider: string } }) => {
        const before = store.rows.length;
        store.rows = store.rows.filter((r) => !(r.orgId === where.orgId && r.provider === where.provider));
        return { count: before - store.rows.length };
      }),
    },
  }),
}));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: vi.fn(async (slug: string) => (slug === "acme" ? "org_1" : null)) }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: mockAudit }));

import {
  deleteProviderConnection,
  getProviderConnection,
  getProviderSecret,
  recordProviderSync,
  setProviderConnection,
} from "./provider-credentials";

const KEY = "sk-admin-UNIT-TEST-secret-value-0123456789";
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  store.rows = [];
  mockAudit.mockClear();
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("provider credentials: the admin key at rest", () => {
  it("stores ciphertext, never the plaintext key", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY });
    const stored = String(store.rows[0]!.credentialRef);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(KEY);
    expect(JSON.stringify(store.rows)).not.toContain(KEY);
  });

  it("round-trips through getProviderSecret, the one server-only reader", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY, projectIds: ["proj_codex"] });
    await expect(getProviderSecret("acme", "openai")).resolves.toEqual({ key: KEY, projectIds: ["proj_codex"], reason: null });
  });

  it("the status row carries hasCredential and NO field holding the key or its ciphertext", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY });
    const row = await getProviderConnection("acme", "openai");
    expect(row?.hasCredential).toBe(true);
    const wire = JSON.stringify(row);
    expect(wire).not.toContain(KEY);
    expect(wire).not.toContain(String(store.rows[0]!.credentialRef));
    expect(Object.keys(row!)).not.toContain("credentialRef");
  });

  it("refuses to store a key when ENCRYPTION_KEY is not configured (fail closed, never plaintext)", async () => {
    delete process.env.ENCRYPTION_KEY;
    await expect(setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY })).rejects.toThrow(/encryption/i);
    expect(store.rows).toHaveLength(0);
  });

  it("reports an undecryptable key (a rotated ENCRYPTION_KEY) as no key, with the reason", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY });
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    await expect(getProviderSecret("acme", "openai")).resolves.toMatchObject({ key: null, reason: "undecryptable" });
  });

  it("an org with no connection has no key", async () => {
    await expect(getProviderSecret("acme", "openai")).resolves.toMatchObject({ key: null, reason: "absent" });
  });
});

describe("provider credentials: connect and disconnect are audited without the secret", () => {
  it("audits the connect, naming the provider and never the key", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY, actorId: "octo" });
    expect(mockAudit).toHaveBeenCalledWith(
      "integrations.openai.connect",
      { provider: "openai", keyUpdated: true, projects: 0 },
      { orgId: "org_1", actorId: "octo" },
    );
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain(KEY);
  });

  it("disconnect deletes the row (the ciphertext dies with it) and audits it", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY });
    await expect(deleteProviderConnection("acme", "openai", { actorId: "octo" })).resolves.toBe(true);
    expect(store.rows).toHaveLength(0);
    expect(mockAudit).toHaveBeenLastCalledWith("integrations.openai.disconnect", { provider: "openai" }, { orgId: "org_1", actorId: "octo" });
  });

  it("a disconnect with nothing stored is a no-op and writes no audit row", async () => {
    await expect(deleteProviderConnection("acme", "openai")).resolves.toBe(false);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("provider credentials: the last sync is recorded with its completeness", () => {
  it("a partial sync is stored as partial with its reason and covered span", async () => {
    await setProviderConnection({ orgSlug: "acme", provider: "openai", credential: KEY });
    await recordProviderSync("acme", "openai", {
      status: "partial",
      detail: "OpenAI rate-limited the pull.",
      from: new Date("2026-07-01T00:00:00Z"),
      through: new Date("2026-08-01T00:00:00Z"),
      at: new Date("2026-09-24T10:05:00Z"),
    });
    const row = await getProviderConnection("acme", "openai");
    expect(row).toMatchObject({
      lastSyncStatus: "partial",
      lastSyncDetail: "OpenAI rate-limited the pull.",
      lastSyncAt: "2026-09-24T10:05:00.000Z",
      lastSyncFrom: "2026-07-01T00:00:00.000Z",
      lastSyncThrough: "2026-08-01T00:00:00.000Z",
    });
  });
});
