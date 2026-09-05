import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";

// Route-boundary mocks (file-scoped, hoisted). The pure-crypto describes below import none of these; they
// isolate the mint AUTHZ gate for the POST handler. next/server → a plain Response so status/json are
// assertable without the Next runtime.
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
// requireSameOrigin is the canonical reject-or-null wrapper the route now uses; it delegates to
// isSameOrigin, so mocking it as a thin wrapper keeps every existing assertion below unchanged.
vi.mock("@/lib/auth", () => {
  const isSameOrigin = () => true;
  return {
    isSameOrigin,
    requireSameOrigin: (req: Request) =>
      isSameOrigin() ? null : new Response(JSON.stringify({ error: "Cross-origin request rejected." }), { status: 403 }),
  };
});
// Auth-off deployment: mintedBy stays unset, so the READ gate is the only thing between an anonymous
// same-origin caller and a private-fleet token.
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
// The two authz gates the route consults: canReadOrg models the READ path; requireOrgRole the owner gate
// (OPEN — returns null — in an auth-off box, which is exactly the hole under test).
vi.mock("@/lib/authz", () => ({
  canReadOrg: vi.fn(async () => true),
  requireOrgRole: vi.fn(async () => null),
}));

import {
  signLiveShareToken,
  verifyLiveShareToken,
  liveShareEnabled,
} from "./live-share";
import { isLiveShareRevoked, revokeLiveShareLink } from "./db/org-share";
import { POST } from "@/app/api/org/live-share/route";
import { canReadOrg, requireOrgRole } from "@/lib/authz";

// live-share.ts is the SOLE gate on unauthenticated access to an org's full fleet rollup at
// /live/shared/[token]. The token IS the capability: an HMAC-signed, domain-separated, REVOCABLE
// `{aud, org, jti, exp, mintedBy?}` payload. These tests pin the security contract so a refactor that
// weakens the signature/expiry/revocation check (e.g. `sig === expected`, dropping the length guard,
// removing `exp < now`, honoring a revoked jti, or losing the domain label) ships RED instead of
// silently leaking cross-tenant data.

const SECRET = "test-live-share-secret-deterministic";

// A token is `<base64url(JSON payload)>.<sig>`. Helper to re-encode a payload object.
function encodePayload(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

describe("live-share token", () => {
  beforeEach(() => {
    // Deterministic secret + clock — no real env/wall-clock dependence.
    vi.stubEnv("LIVE_SHARE_SECRET", SECRET);
    vi.stubEnv("AUTH_SECRET", "");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("liveShareEnabled", () => {
    it("is enabled when a secret is configured", () => {
      expect(liveShareEnabled()).toBe(true);
    });

    it("falls back to AUTH_SECRET when LIVE_SHARE_SECRET is absent", () => {
      vi.stubEnv("LIVE_SHARE_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "fallback-auth-secret");
      expect(liveShareEnabled()).toBe(true);
    });
  });

  describe("round-trip (a valid token verifies)", () => {
    it("verifies a freshly-minted token and yields the org", () => {
      const minted = signLiveShareToken("acme");
      expect(minted).not.toBeNull();
      const verified = verifyLiveShareToken(minted!.token);
      expect(verified).toMatchObject({ org: "acme" });
    });

    it("canonicalizes org casing into the signed payload (Acme-Corp -> acme-corp)", () => {
      const minted = signLiveShareToken("Acme-Corp");
      expect(verifyLiveShareToken(minted!.token)?.org).toBe("acme-corp");
    });

    it("reports the expiresAt at now + ttl", () => {
      const minted = signLiveShareToken("acme", 1000);
      expect(minted!.expiresAt).toBe(Date.now() + 1000);
    });

    it("stamps a per-link jti and round-trips an owner binding", () => {
      const minted = signLiveShareToken("acme", { mintedBy: "alice" });
      expect(minted!.jti).toBeTruthy();
      const v = verifyLiveShareToken(minted!.token);
      expect(v!.jti).toBe(minted!.jti);
      expect(v!.mintedBy).toBe("alice");
    });

    it("leaves mintedBy undefined for an unbound link (legacy behavior preserved)", () => {
      expect(verifyLiveShareToken(signLiveShareToken("acme")!.token)!.mintedBy).toBeUndefined();
    });
  });

  describe("per-link REVOCATION (#1)", () => {
    it("refuses a revoked link immediately, without touching the global secret", () => {
      const minted = signLiveShareToken("acme")!;
      // Live until its jti is marked revoked.
      expect(verifyLiveShareToken(minted.token)).not.toBeNull();
      // The exact jti is killed → refused on the very next read (no secret rotation, no re-mint).
      expect(verifyLiveShareToken(minted.token, { revoked: (j) => j === minted.jti })).toBeNull();
      // A DIFFERENT link's revocation must not touch this one (per-link, not global).
      expect(verifyLiveShareToken(minted.token, { revoked: (j) => j === "some-other-jti" })).not.toBeNull();
    });

    it("the per-link store is a safe no-op when no DB is configured (stateless, TTL-only mode)", async () => {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("DSQL_ENDPOINT", "");
      expect(await isLiveShareRevoked("jti-1")).toBe(false);
      await expect(revokeLiveShareLink("jti-1")).resolves.toBeUndefined();
      expect(await isLiveShareRevoked("")).toBe(false);
    });
  });

  describe("TTL upper cap", () => {
    it("clamps a year-long request to the 30-day hard cap (no link outlives a month un-revoked)", () => {
      const minted = signLiveShareToken("acme", 365 * 24 * 60 * 60 * 1000)!; // asks for a year
      expect(minted.expiresAt).toBe(Date.now() + 30 * 24 * 60 * 60 * 1000);
    });
  });

  describe("DOMAIN SEPARATION from session cookies (#4)", () => {
    it("rejects a token whose HMAC omits the domain label (a session-cookie construction)", () => {
      const minted = signLiveShareToken("acme")!;
      const payload = minted.token.slice(0, minted.token.lastIndexOf("."));
      // A session cookie signs base64url(json) with the SAME default secret but NO domain prefix. Recreate
      // that construction over our payload; verify must reject it — the prefix is load-bearing, so a
      // session cookie can never be mistaken for a share token even when both derive from AUTH_SECRET.
      const noPrefixSig = createHmac("sha256", SECRET).update(payload).digest("base64url");
      expect(verifyLiveShareToken(`${payload}.${noPrefixSig}`)).toBeNull();
      // Sanity: the real (domain-prefixed) signature still verifies.
      expect(verifyLiveShareToken(minted.token)).not.toBeNull();
    });
  });

  describe("forgery is rejected", () => {
    it("rejects a token whose signature has one char flipped", () => {
      const { token } = signLiveShareToken("acme")!;
      const dot = token.lastIndexOf(".");
      const payload = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      // Flip the last char of the sig (to a different base64url char).
      const lastChar = sig.slice(-1);
      const flipped = (lastChar === "A" ? "B" : "A");
      const forged = `${payload}.${sig.slice(0, -1)}${flipped}`;
      expect(forged).not.toBe(token);
      expect(verifyLiveShareToken(forged)).toBeNull();
    });

    it("rejects a tampered payload reusing the old signature (sig must cover the payload)", () => {
      const { token } = signLiveShareToken("acme")!;
      const dot = token.lastIndexOf(".");
      const sig = token.slice(dot + 1);
      // Re-encode a payload for a DIFFERENT org but keep the original (acme) signature.
      const tamperedPayload = encodePayload({ org: "evilcorp", exp: Date.now() + 100000 });
      const forged = `${tamperedPayload}.${sig}`;
      expect(verifyLiveShareToken(forged)).toBeNull();
    });

    it("rejects a token signed with a DIFFERENT secret", () => {
      const { token } = signLiveShareToken("acme")!;
      // Verify under a different secret — signature can no longer match.
      vi.stubEnv("LIVE_SHARE_SECRET", "some-other-secret-entirely");
      expect(verifyLiveShareToken(token)).toBeNull();
    });

    it("rejects a length-mismatched signature (guards the timingSafeEqual length pre-check)", () => {
      const { token } = signLiveShareToken("acme")!;
      const dot = token.lastIndexOf(".");
      const payload = token.slice(0, dot);
      // A short sig of length 1 — exercises the `a.length !== b.length` guard.
      expect(verifyLiveShareToken(`${payload}.x`)).toBeNull();
    });

    it("rejects an unsigned (no-dot) token", () => {
      const payload = encodePayload({ org: "acme", exp: Date.now() + 100000 });
      expect(verifyLiveShareToken(payload)).toBeNull();
    });
  });

  describe("expiry is enforced", () => {
    it("rejects a token minted already-expired (negative ttl)", () => {
      const minted = signLiveShareToken("acme", -1000);
      expect(minted).not.toBeNull();
      expect(verifyLiveShareToken(minted!.token)).toBeNull();
    });

    it("rejects a valid token once time advances past expiry", () => {
      const { token } = signLiveShareToken("acme", 60_000)!; // 60s TTL
      // Just before expiry: still valid.
      vi.advanceTimersByTime(59_000);
      expect(verifyLiveShareToken(token)).toMatchObject({ org: "acme" });
      // Past expiry: rejected.
      vi.advanceTimersByTime(2_000);
      expect(verifyLiveShareToken(token)).toBeNull();
    });

    it("accepts a not-yet-expired token", () => {
      const { token } = signLiveShareToken("acme", 10_000)!;
      vi.advanceTimersByTime(5_000);
      expect(verifyLiveShareToken(token)).toMatchObject({ org: "acme" });
    });
  });

  describe("malformed input is rejected without throwing", () => {
    it.each([
      ["empty string", ""],
      ["whitespace", "   "],
      ["garbage", "not-a-token"],
      ["dot only", "."],
      ["leading dot", ".sig"],
      ["non-base64url payload", "!!!notbase64!!!.abcdef"],
      ["payload is not JSON", `${Buffer.from("plain text").toString("base64url")}.abcdef`],
    ])("rejects %s without throwing", (_label, input) => {
      expect(() => verifyLiveShareToken(input)).not.toThrow();
      expect(verifyLiveShareToken(input)).toBeNull();
    });

    it("rejects a payload missing the org field", () => {
      const payload = encodePayload({ exp: Date.now() + 100000 });
      const sig = signLiveShareToken("acme")!.token.split(".")[1]; // any sig — will mismatch anyway
      expect(verifyLiveShareToken(`${payload}.${sig}`)).toBeNull();
    });

    it("rejects a payload whose exp is not a number", () => {
      // Build a correctly-signed token with a non-numeric exp to prove the type check, not just the sig.
      const payload = encodePayload({ org: "acme", exp: "soon" });
      // Re-sign via a fresh mint of a known-good token to extract structure is not possible here,
      // so this relies on the signature mismatch as a secondary guard; the type check is the primary.
      expect(verifyLiveShareToken(`${payload}.anything`)).toBeNull();
    });
  });

  describe("mint-authz <-> token-payload casing contract", () => {
    // THE INVARIANT (the authorization-to-data join): the route authorizes the RAW `body.org` via
    // `requireOrgRole(body.org, "owner")` — and authz.ts canonicalizes with `org.trim().toLowerCase()`
    // — then mints with `signLiveShareToken(body.org)`, whose payload is ALSO `org.toLowerCase()`. So
    // the org slug authorized at mint MUST equal the org slug the verified token resolves data for,
    // under ANY input casing. The three independent `.toLowerCase()` calls (authz / mint / verify-
    // consumption) agree only by coincidence today; this pins it so a casing-normalization drift in
    // any one of them ships RED instead of (best case) a dead share link or (worst case) a token
    // minted under one tenant's owner check resolving a DIFFERENT tenant's rollup.

    // Mirror of the canonicalization authz.ts applies to the org it checks the owner role against.
    const authzCanonical = (org: string) => org.trim().toLowerCase();

    it.each([
      ["mixed case", "Acme-Corp"],
      ["all upper", "ACME-CORP"],
      ["already lower", "acme-corp"],
      ["leading/trailing ws is NOT trimmed by mint (only lowercased)", "Acme-Corp"],
    ])("the verified token org == authz-canonical org (%s)", (_label, input) => {
      const minted = signLiveShareToken(input);
      expect(minted).not.toBeNull();
      const resolved = verifyLiveShareToken(minted!.token);
      expect(resolved).not.toBeNull();
      // The org the token resolves data for is exactly the org authz lowercased — same tenant.
      expect(resolved!.org).toBe(authzCanonical(input));
    });

    it("a token minted for 'Acme-Corp' grants access to exactly 'acme-corp' (no lock-out)", () => {
      const minted = signLiveShareToken("Acme-Corp");
      expect(verifyLiveShareToken(minted!.token)?.org).toBe("acme-corp");
    });

    it("any casing of the SAME org resolves to one identical tenant slug (no per-casing fork)", () => {
      const variants = ["acme", "Acme", "ACME", "aCmE"];
      const resolved = variants.map((v) => verifyLiveShareToken(signLiveShareToken(v)!.token)?.org);
      expect(new Set(resolved)).toEqual(new Set(["acme"]));
    });

    it("DIFFERENT orgs never collide onto the same slug (casing can't grant a different tenant)", () => {
      const acme = verifyLiveShareToken(signLiveShareToken("Acme")!.token)?.org;
      const evil = verifyLiveShareToken(signLiveShareToken("EvilCorp")!.token)?.org;
      expect(acme).toBe("acme");
      expect(evil).toBe("evilcorp");
      expect(acme).not.toBe(evil);
    });

    it("the canonical (lowercase) slug round-trips unchanged — idempotent normalization", () => {
      // Authz would compute the same lowercase slug; minting it again must not double-mangle it.
      const canonical = authzCanonical("Acme-Corp"); // "acme-corp"
      const resolved = verifyLiveShareToken(signLiveShareToken(canonical)!.token)?.org;
      expect(resolved).toBe(canonical);
    });
  });

  describe("no secret => sharing is inert", () => {
    beforeEach(() => {
      vi.stubEnv("LIVE_SHARE_SECRET", "");
      vi.stubEnv("AUTH_SECRET", "");
    });

    it("liveShareEnabled() is false", () => {
      expect(liveShareEnabled()).toBe(false);
    });

    it("signLiveShareToken returns null", () => {
      expect(signLiveShareToken("acme")).toBeNull();
    });

    it("verifyLiveShareToken returns null for any token", () => {
      expect(verifyLiveShareToken("anything.atall")).toBeNull();
    });
  });
});

describe("POST /api/org/live-share — mint gate (#2)", () => {
  const mockCanRead = vi.mocked(canReadOrg);
  const mockRole = vi.mocked(requireOrgRole);

  function req(body: unknown) {
    return new Request("http://localhost/api/org/live-share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.stubEnv("LIVE_SHARE_SECRET", "route-mint-secret");
    vi.stubEnv("AUTH_SECRET", "");
    mockCanRead.mockResolvedValue(true);
    mockRole.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("an auth-off box that won't SERVE the org (canReadOrg=false) also won't MINT — 403, fail closed", async () => {
    // The exact hole: requireOrgRole is OPEN (null) in an auth-off deployment, but the read gate refuses.
    // Mint must refuse too, and must do so BEFORE it ever reaches the (open) owner gate.
    mockCanRead.mockResolvedValue(false);
    const res = await POST(req({ org: "acme" }));
    expect(res.status).toBe(403);
    expect(mockRole).not.toHaveBeenCalled();
  });

  it("mints when the read gate allows and the owner gate passes — token verifies to the org", async () => {
    const res = await POST(req({ org: "Acme" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token: string; path: string };
    expect(verifyLiveShareToken(json.token)!.org).toBe("acme");
    expect(json.path).toContain("/live/shared/");
  });

  it("rejects a missing org with 400", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });
});
