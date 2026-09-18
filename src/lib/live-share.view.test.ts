// The kiosk link's `view` claim (spark theater-upgrade): `theater` round-trips through the signature,
// every token minted without it — including every token minted before it existed — reads as `wall`,
// and the mint route accepts `view` and refuses anything that is not one of the two.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: () => null }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({ canReadOrg: vi.fn(async () => true), requireOrgRole: vi.fn(async () => null) }));

import { createHmac } from "node:crypto";
import { normalizeLiveShareView, signLiveShareToken, verifyLiveShareToken } from "./live-share";
import { POST } from "@/app/api/org/live-share/route";

const SECRET = "test-live-share-view-secret";

beforeEach(() => {
  vi.stubEnv("LIVE_SHARE_SECRET", SECRET);
  vi.stubEnv("AUTH_SECRET", "");
});
afterEach(() => vi.unstubAllEnvs());

const payloadOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;

describe("the view claim", () => {
  it("a theater token round-trips its view", () => {
    const minted = signLiveShareToken("acme", { view: "theater" })!;
    expect(verifyLiveShareToken(minted.token)).toMatchObject({ org: "acme", view: "theater" });
  });

  it("a default token reads as the wall, and its payload carries no view at all (byte-for-byte the old shape)", () => {
    const minted = signLiveShareToken("acme")!;
    expect(verifyLiveShareToken(minted.token)).toMatchObject({ org: "acme", view: "wall" });
    expect(Object.keys(payloadOf(minted.token)).sort()).toEqual(["aud", "exp", "jti", "org"]);
    expect("view" in payloadOf(signLiveShareToken("acme", { view: "wall" })!.token)).toBe(false);
  });

  it("an OLD token — minted before the claim existed — still verifies, as the wall", () => {
    // Hand-built exactly as the pre-theater signer did: {aud, org, jti, mintedBy?, exp}, domain-prefixed HMAC.
    const payload = Buffer.from(JSON.stringify({ aud: "live-share.v1", org: "acme", jti: "old-jti", exp: Date.now() + 60_000 })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(`live-share.v1.${payload}`).digest("base64url");
    expect(verifyLiveShareToken(`${payload}.${sig}`)).toEqual({ org: "acme", jti: "old-jti", mintedBy: undefined, view: "wall" });
  });

  it("the view is covered by the signature: flipping it in the payload breaks the token", () => {
    const minted = signLiveShareToken("acme")!;
    const [payload, sig] = minted.token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payloadOf(minted.token), view: "theater" })).toString("base64url");
    expect(verifyLiveShareToken(`${forged}.${sig}`)).toBeNull();
    expect(payload).not.toBe(forged);
  });

  it("an unknown view value in a (validly signed) payload is the wall, never a third mode", () => {
    const payload = Buffer.from(JSON.stringify({ aud: "live-share.v1", org: "acme", jti: "j", exp: Date.now() + 60_000, view: "cockpit" })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(`live-share.v1.${payload}`).digest("base64url");
    expect(verifyLiveShareToken(`${payload}.${sig}`)?.view).toBe("wall");
  });

  it("normalizeLiveShareView: absent/wall → wall, theater → theater, anything else → null", () => {
    expect(normalizeLiveShareView(undefined)).toBe("wall");
    expect(normalizeLiveShareView("wall")).toBe("wall");
    expect(normalizeLiveShareView("theater")).toBe("theater");
    expect(normalizeLiveShareView("cockpit")).toBeNull();
    expect(normalizeLiveShareView(1)).toBeNull();
  });
});

describe("POST /api/org/live-share — view", () => {
  const mint = (body: unknown) =>
    POST(new Request("http://localhost/api/org/live-share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("mints a theater link when asked, and the link verifies as the theater", async () => {
    const res = await mint({ org: "acme", view: "theater" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as { token: string; path: string; view: string };
    expect(d.view).toBe("theater");
    expect(d.path).toBe(`/live/shared/${d.token}`);
    expect(verifyLiveShareToken(d.token)?.view).toBe("theater");
  });

  it("the request every existing caller sends ({ org }) still mints a wall link", async () => {
    const d = (await (await mint({ org: "acme" })).json()) as { token: string; view: string };
    expect(d.view).toBe("wall");
    expect(verifyLiveShareToken(d.token)?.view).toBe("wall");
  });

  it("refuses a view that is not one of the two", async () => {
    expect((await mint({ org: "acme", view: "cockpit" })).status).toBe(400);
  });
});
