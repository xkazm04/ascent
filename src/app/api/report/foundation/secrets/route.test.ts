// Pins the five properties that make writing a credential into a customer repo defensible
// (moonshot #35). Each one is a thing that, if it regressed, would be invisible in review:
//
//   1. ADMIN IS NOT ENOUGH — the gate asks for "owner", not "admin". This is the one write in the lane
//      that takes effect with no review step in between.
//   2. A wrong (or absent) typed confirmation refuses, and refuses AFTER the role gate, so the 400's
//      phrasing tells an unauthorized caller nothing.
//   3. ASCENT_CONFORMANCE_URL comes from the SERVER, even when the body supplies one — otherwise the
//      route is a primitive for pointing someone else's CI at an attacker's host.
//   4. The raw token never appears in any recordOrgAudit meta — only its display prefix.
//   5. DELETE removes BOTH secrets AND revokes the token, so nothing Ascent wrote survives it.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

vi.mock("@/lib/github/source", () => ({
  parseRepoUrl: (input: string) => {
    const parts = String(input || "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo!)) return null;
    return { owner, repo };
  },
}));

vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {
    constructor(
      readonly status: number,
      readonly path: string,
      readonly body: string,
    ) {
      super(`GitHub App API ${status}`);
      this.name = "AppApiError";
    }
  },
  isAppConfigured: () => true,
}));

vi.mock("@/lib/github/pr-route", () => ({
  requirePrWriteContext: vi.fn(async () => ({ token: "installation-token" })),
  classifyPrWriteError: vi.fn(() => null),
}));

vi.mock("@/lib/github/actions-secrets", () => ({
  CONFORMANCE_SECRETS: ["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"] as const,
  putRepoSecret: vi.fn(async () => {}),
  deleteRepoSecret: vi.fn(async () => {}),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  recordOrgAudit: vi.fn(async () => true),
  getInstallationIdForOwner: vi.fn(async () => "4242"),
}));

// An in-memory token table, so "is a/one's credential still live?" is a real question with a real
// answer rather than an assertion about which mock was called.
interface FakeToken {
  id: string;
  name: string;
  raw: string;
  revoked: boolean;
}
const store = vi.hoisted(() => ({ tokens: [] as FakeToken[], seq: 0 }));
vi.mock("@/lib/db/org-api-tokens", () => ({
  createOrgApiToken: vi.fn(async (_org: string, input: { name: string }) => {
    store.seq += 1;
    const raw = store.seq === 1 ? "askl_RAWSECRETVALUE" : `askl_RAWSECRETVALUE${store.seq}`;
    const t = { id: `tok_${store.seq}`, name: input.name, raw, revoked: false };
    store.tokens.push(t);
    return { token: raw, summary: { id: t.id, name: t.name, tokenPrefix: raw.slice(0, 12) } };
  }),
  revokeOrgApiTokensByName: vi.fn(async (_org: string, name: string, opts?: { exceptId?: string }) => {
    const hit = store.tokens.filter((t) => !t.revoked && t.name === name && t.id !== opts?.exceptId);
    for (const t of hit) t.revoked = true;
    return hit.length;
  }),
  revokeOrgApiToken: vi.fn(async (_org: string, id: string) => {
    const t = store.tokens.find((x) => x.id === id && !x.revoked);
    if (t) t.revoked = true;
    return !!t;
  }),
}));

vi.mock("@/lib/db/org-foundation", () => ({ getFoundationRollout: vi.fn(async () => []) }));

vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  isAuthConfigured: () => true,
  requireSameOrigin: vi.fn(() => null),
  readableOrgForOwner: vi.fn(async (owner: string) => owner.toLowerCase()),
}));

vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  resolveViewerLogin: vi.fn(async () => "alice"),
}));

vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));

vi.mock("@/lib/site", () => ({ publicBaseUrl: vi.fn(() => "") }));

import { POST, DELETE } from "./route";
import { requireOrgRole } from "@/lib/authz";
import { readableOrgForOwner } from "@/lib/auth";
import { recordOrgAudit } from "@/lib/db";
import { createOrgApiToken, revokeOrgApiTokensByName } from "@/lib/db/org-api-tokens";
import { getFoundationRollout } from "@/lib/db/org-foundation";
import { LEGACY_TOKEN_NAME, tokenNameFor } from "@/lib/github/reportback-credential";
import { deleteRepoSecret, putRepoSecret } from "@/lib/github/actions-secrets";
import { publicBaseUrl } from "@/lib/site";

const mockRole = vi.mocked(requireOrgRole);
const mockOrgForOwner = vi.mocked(readableOrgForOwner);
const mockAudit = vi.mocked(recordOrgAudit);
const mockEnsure = vi.mocked(createOrgApiToken);
const mockRollout = vi.mocked(getFoundationRollout);
const mockRevoke = vi.mocked(revokeOrgApiTokensByName);
const mockPut = vi.mocked(putRepoSecret);
const mockDelete = vi.mocked(deleteRepoSecret);
const mockBaseUrl = vi.mocked(publicBaseUrl);

const ORIGIN = "https://ascent.example";

function req(method: "POST" | "DELETE", body: Record<string, unknown>) {
  return new Request(`${ORIGIN}/api/report/foundation/secrets`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const post = (b: Record<string, unknown>) => POST(req("POST", b));
const del = (b: Record<string, unknown>) => DELETE(req("DELETE", b));

const OK = { org: "acme", repos: ["acme/app"], confirm: "acme/app" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.mockResolvedValue(null);
  mockOrgForOwner.mockImplementation(async (owner: string) => owner.toLowerCase());
  mockBaseUrl.mockReturnValue("");
  store.tokens.length = 0;
  store.seq = 0;
  mockRollout.mockResolvedValue([]);
});

const isLive = (raw: string) => store.tokens.some((t) => t.raw === raw && !t.revoked);

describe("authorization", () => {
  it("asks for OWNER — admin is not enough for a credential write", async () => {
    await post(OK);
    expect(mockRole).toHaveBeenCalledWith("acme", "owner");
  });

  it("a denied role short-circuits before any token mint or secret write", async () => {
    mockRole.mockResolvedValue(Response.json({ error: "owner only" }, { status: 403 }) as never);
    const res = await post(OK);
    expect(res.status).toBe(403);
    expect(mockEnsure).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a public (non-org-owned) repo", async () => {
    mockOrgForOwner.mockResolvedValue("public");
    expect((await post({ ...OK, org: undefined })).status).toBe(403);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("refuses a caller-supplied org that disagrees with the repo's owner", async () => {
    const res = await post({ org: "attacker", repos: ["victim/app"], confirm: "victim/app" });
    expect(res.status).toBe(403);
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe("typed confirmation", () => {
  it("a wrong confirm is a 400 and writes nothing", async () => {
    const res = await post({ ...OK, confirm: "acme/other" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("acme/app") });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("a missing confirm is a 400", async () => {
    expect((await post({ org: "acme", repos: ["acme/app"] })).status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("is checked AFTER the role gate — an unauthorized caller learns nothing from the message", async () => {
    mockRole.mockResolvedValue(Response.json({ error: "owner only" }, { status: 403 }) as never);
    const res = await post({ org: "acme", repos: ["acme/app"], confirm: "wrong" });
    expect(await res.json()).toMatchObject({ error: "owner only" });
  });

  it("refuses more than one repo per confirmation", async () => {
    const res = await post({ org: "acme", repos: ["acme/app", "acme/api"], confirm: "acme/app" });
    expect(res.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe("the report URL is server-derived", () => {
  it("uses the request origin, IGNORING a body-supplied url", async () => {
    await post({ ...OK, reportUrl: "https://evil.example/collect", url: "https://evil.example/collect" });
    const urlWrite = mockPut.mock.calls.find((c) => c[3] === "ASCENT_CONFORMANCE_URL")!;
    expect(urlWrite[4]).toBe(`${ORIGIN}/api/report/conformance`);
    expect(JSON.stringify(mockPut.mock.calls)).not.toContain("evil.example");
  });

  it("prefers the configured public origin when one is set", async () => {
    mockBaseUrl.mockReturnValue("https://ascent.acme.internal");
    await post(OK);
    const urlWrite = mockPut.mock.calls.find((c) => c[3] === "ASCENT_CONFORMANCE_URL")!;
    expect(urlWrite[4]).toBe("https://ascent.acme.internal/api/report/conformance");
  });
});

describe("provisioning", () => {
  it("mints a FRESH telemetry:write token under the repo's own name and writes both secrets", async () => {
    const res = await post(OK);
    expect(res.status).toBe(200);
    expect(mockEnsure).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ name: tokenNameFor("acme/app"), scopes: ["telemetry:write"] }),
    );
    expect(mockPut.mock.calls.map((c) => c[3])).toEqual(["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"]);
    const tokenWrite = mockPut.mock.calls.find((c) => c[3] === "ASCENT_CONFORMANCE_TOKEN")!;
    expect(tokenWrite[4]).toBe("askl_RAWSECRETVALUE");
    expect(await res.json()).toMatchObject({ tokenPrefix: "askl_RAWSECR", results: [{ repo: "acme/app", ok: true }] });
  });

  it("NEVER puts the raw token in an audit row — only its display prefix", async () => {
    await post(OK);
    const metas = JSON.stringify(mockAudit.mock.calls.map((c) => c[2]));
    expect(metas).not.toContain("askl_RAWSECRETVALUE");
    expect(metas).toContain("askl_RAWSECR");
    expect(mockAudit.mock.calls[0]![0]).toBe("foundation.reportback_provisioned");
    expect(mockAudit.mock.calls[0]![2]).toMatchObject({
      repo: "acme/app",
      secrets: ["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"],
      reusedToken: false,
    });
  });

  it("reports a secrets:write permission failure instead of throwing", async () => {
    const { classifyPrWriteError } = await import("@/lib/github/pr-route");
    vi.mocked(classifyPrWriteError).mockReturnValue({ status: 403, message: "no scope" });
    mockPut.mockRejectedValueOnce(new Error("403"));
    const res = await post(OK);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false });
    expect(body.results[0].error).toMatch(/Secrets write access/);
  });

  it("500s (writing nothing) when no token could be minted", async () => {
    mockEnsure.mockResolvedValueOnce(null);
    const res = await post(OK);
    expect(res.status).toBe(500);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe("DELETE tears the whole thing down", () => {
  it("removes BOTH secrets and revokes the token", async () => {
    const res = await del(OK);
    expect(res.status).toBe(200);
    expect(mockDelete.mock.calls.map((c) => c[3])).toEqual([
      "ASCENT_CONFORMANCE_URL",
      "ASCENT_CONFORMANCE_TOKEN",
    ]);
    expect(mockRevoke).toHaveBeenCalledWith("acme", tokenNameFor("acme/app"));
    expect(await res.json()).toMatchObject({ removed: 2 });
    expect(mockAudit.mock.calls[0]![0]).toBe("foundation.reportback_revoked");
  });

  it("revokes the token EVEN IF the secret removal failed — a live bearer must not survive", async () => {
    mockDelete.mockRejectedValueOnce(new Error("boom"));
    const res = await del(OK);
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalled();
    expect((await res.json()).results[0].ok).toBe(false);
  });

  it("carries the same owner gate + typed confirmation as POST", async () => {
    await del(OK);
    expect(mockRole).toHaveBeenCalledWith("acme", "owner");
    vi.clearAllMocks();
    mockRole.mockResolvedValue(null);
    expect((await del({ ...OK, confirm: "nope" })).status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe("one credential per repo (policy-tighten)", () => {
  const ONE = { org: "a", repos: ["a/one"], confirm: "a/one" };
  const TWO = { org: "a", repos: ["a/two"], confirm: "a/two" };
  const tokenOf = (repo: string) =>
    mockPut.mock.calls.filter((c) => `${c[1]}/${c[2]}` === repo && c[3] === "ASCENT_CONFORMANCE_TOKEN").map((c) => c[4] as string);

  it("provisioning a/two leaves the token written into a/one live, under a distinct name", async () => {
    await post(ONE);
    await post(TWO);
    const [one] = tokenOf("a/one");
    const [two] = tokenOf("a/two");
    expect(isLive(one!)).toBe(true);
    expect(isLive(two!)).toBe(true);
    const names = store.tokens.map((t) => t.name);
    expect(names).toEqual([tokenNameFor("a/one"), tokenNameFor("a/two")]);
  });

  it("DELETE on a/two revokes only a/two's token", async () => {
    await post(ONE);
    await post(TWO);
    await del(TWO);
    expect(isLive(tokenOf("a/one")[0]!)).toBe(true);
    expect(isLive(tokenOf("a/two")[0]!)).toBe(false);
    expect(mockRevoke).not.toHaveBeenCalledWith("a", LEGACY_TOKEN_NAME);
  });

  it("a 403 re-provision keeps the previous token live and revokes the just-minted one", async () => {
    await post(ONE);
    const first = tokenOf("a/one")[0]!;
    const { classifyPrWriteError } = await import("@/lib/github/pr-route");
    vi.mocked(classifyPrWriteError).mockReturnValue({ status: 403, message: "no scope" });
    mockPut.mockImplementationOnce(async () => {
      // Never a window with none: the old credential is still live while the write is in flight.
      expect(isLive(first)).toBe(true);
      throw new Error("403");
    });
    const res = await post(ONE);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, reason: "missing-permission" });
    expect(body.results[0].configureUrl).toBe("https://github.com/settings/installations/4242");
    expect(isLive(first)).toBe(true);
    expect(store.tokens[1]!.revoked).toBe(true);
    const meta = mockAudit.mock.calls.at(-1)![2] as Record<string, unknown>;
    expect(meta).toMatchObject({ ok: false, reason: "missing-permission", tokenName: tokenNameFor("a/one") });
    expect(JSON.stringify(meta)).not.toContain("askl_RAWSECRETVALUE");
  });

  it("a successful re-provision retires that repo's previous token only after the write", async () => {
    await post(ONE);
    await post(TWO);
    const first = tokenOf("a/one")[0]!;
    await post(ONE);
    expect(isLive(first)).toBe(false);
    expect(isLive(tokenOf("a/one")[1]!)).toBe(true);
    expect(isLive(tokenOf("a/two")[0]!)).toBe(true);
  });

  it("the legacy shared token is revoked only by its holder, and only when no OTHER repo still reads legacy-shared", async () => {
    const legacy = (repo: string) =>
      ({ repo, foundationPrAt: null, reportBackAt: "2026-08-01T00:00:00.000Z", conformance: null, conformanceAt: null, reportBack: { state: "legacy-shared" } }) as never;
    mockRollout.mockResolvedValue([legacy("a/one"), legacy("a/two")]);
    await del(TWO);
    expect(mockRevoke).not.toHaveBeenCalledWith("a", LEGACY_TOKEN_NAME);
    mockRollout.mockResolvedValue([legacy("a/one")]);
    await del(TWO);
    expect(mockRevoke).not.toHaveBeenCalledWith("a", LEGACY_TOKEN_NAME);
    mockRollout.mockRejectedValue(new Error("db down"));
    await del(TWO);
    expect(mockRevoke).not.toHaveBeenCalledWith("a", LEGACY_TOKEN_NAME);
    mockRollout.mockResolvedValue([legacy("a/two")]);
    await del(TWO);
    expect(mockRevoke).toHaveBeenCalledWith("a", LEGACY_TOKEN_NAME);
  });
});
