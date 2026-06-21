// Tests for the BYOM db layer (Feature 1) — the security-critical boundary. Prisma + getCreditState are
// mocked; secret-box runs REAL (ENCRYPTION_KEY set) so we pin:
//   - setOrgLlmConfig ENCRYPTS the credential (stored blob is a v1: ciphertext, NOT the plaintext) and
//     rejects a partial credential;
//   - getOrgLlmConfig exposes hasCredentials (presence) but NEVER the secret;
//   - isByomActive requires enabled + creds + Enterprise plan + encryption (fail closed);
//   - resolveByomProvider is the only decrypt path and returns null (never throws) on a tampered blob.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockGetPrisma, mockGetCreditState } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockGetCreditState: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/credits", () => ({ getCreditState: mockGetCreditState }));

import {
  getOrgLlmConfig,
  setOrgLlmConfig,
  isByomActive,
  resolveByomProvider,
} from "@/lib/db/org-llm";
import { encryptSecret } from "@/lib/crypto/secret-box";

const ENC_KEY = Buffer.alloc(32, 5).toString("base64");
const original = process.env.ENCRYPTION_KEY;
beforeEach(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
  vi.clearAllMocks();
  mockGetCreditState.mockResolvedValue({ plan: "enterprise", balance: 0, unlimited: true });
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

function fakePrisma(row: Record<string, unknown> | null = null) {
  const calls = { upsert: [] as { create: Record<string, unknown>; update: Record<string, unknown> }[] };
  const prisma = {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    orgLlmConfig: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        calls.upsert.push(args);
        return { id: "cfg_1" };
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { prisma, calls };
}

describe("setOrgLlmConfig — encryption at rest", () => {
  it("stores an ENCRYPTED blob, never the plaintext secret", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    const res = await setOrgLlmConfig("acme", { modelId: "m", accessKeyId: "AKIA123", secretAccessKey: "topsecret" });
    expect(res.ok).toBe(true);
    const blob = calls.upsert[0].create.credentialsEncrypted as string;
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("topsecret");
    expect(blob).not.toContain("AKIA123");
  });

  it("rejects a PARTIAL credential (one key without the other)", async () => {
    const { prisma } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    const res = await setOrgLlmConfig("acme", { modelId: "m", accessKeyId: "AKIA123" });
    expect(res.ok).toBe(false);
  });

  it("fails closed when ENCRYPTION_KEY is unset and creds are supplied", async () => {
    delete process.env.ENCRYPTION_KEY;
    const { prisma } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    const res = await setOrgLlmConfig("acme", { modelId: "m", accessKeyId: "AKIA", secretAccessKey: "s" });
    expect(res.ok).toBe(false);
  });
});

describe("getOrgLlmConfig — never leaks the secret", () => {
  it("returns hasCredentials:true but no secret field", async () => {
    const { prisma } = fakePrisma({
      provider: "bedrock",
      enabled: true,
      modelId: "m",
      region: "us-east-1",
      authMode: "static",
      credentialsEncrypted: "v1:a:b:c",
      lastValidatedAt: null,
      lastValidationError: null,
      createdBy: null,
      updatedAt: new Date(),
    });
    mockGetPrisma.mockReturnValue(prisma);
    const cfg = await getOrgLlmConfig("acme");
    expect(cfg?.hasCredentials).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain("credentialsEncrypted");
    expect(JSON.stringify(cfg)).not.toContain("v1:a:b:c");
  });
});

describe("isByomActive — fail-closed gating", () => {
  const activeRow = { enabled: true, credentialsEncrypted: "v1:x" };
  it("true with enabled + creds + Enterprise plan + encryption", async () => {
    const { prisma } = fakePrisma(activeRow);
    mockGetPrisma.mockReturnValue(prisma);
    expect(await isByomActive("acme")).toBe(true);
  });
  it("false on a non-Enterprise plan", async () => {
    const { prisma } = fakePrisma(activeRow);
    mockGetPrisma.mockReturnValue(prisma);
    mockGetCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
    expect(await isByomActive("acme")).toBe(false);
  });
  it("false when not enabled or no creds", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma({ enabled: false, credentialsEncrypted: "v1:x" }).prisma);
    expect(await isByomActive("acme")).toBe(false);
    mockGetPrisma.mockReturnValue(fakePrisma({ enabled: true, credentialsEncrypted: null }).prisma);
    expect(await isByomActive("acme")).toBe(false);
  });
  it("false when encryption is unconfigured (fail closed)", async () => {
    delete process.env.ENCRYPTION_KEY;
    mockGetPrisma.mockReturnValue(fakePrisma(activeRow).prisma);
    expect(await isByomActive("acme")).toBe(false);
  });
});

describe("resolveByomProvider — the only decrypt path", () => {
  it("returns decrypted provider params when active", async () => {
    const blob = encryptSecret(JSON.stringify({ accessKeyId: "AKIA", secretAccessKey: "sec" }));
    const { prisma } = fakePrisma({ enabled: true, credentialsEncrypted: blob, provider: "bedrock", modelId: "m", region: "us-east-1" });
    mockGetPrisma.mockReturnValue(prisma);
    const params = await resolveByomProvider("acme");
    expect(params).toEqual({ model: "m", region: "us-east-1", credentials: { accessKeyId: "AKIA", secretAccessKey: "sec" } });
  });

  it("returns null (no throw) on a tampered blob", async () => {
    const { prisma } = fakePrisma({ enabled: true, credentialsEncrypted: "v1:bad:blob:here", provider: "bedrock", modelId: "m", region: null });
    mockGetPrisma.mockReturnValue(prisma);
    await expect(resolveByomProvider("acme")).resolves.toBeNull();
  });

  it("returns null when not active (non-enterprise)", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "pro", balance: 0, unlimited: false });
    const { prisma } = fakePrisma({ enabled: true, credentialsEncrypted: "v1:x", provider: "bedrock", modelId: "m", region: null });
    mockGetPrisma.mockReturnValue(prisma);
    await expect(resolveByomProvider("acme")).resolves.toBeNull();
  });
});
