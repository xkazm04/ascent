// GET /api/live/pulse — the one unauthenticated read of the runner. It must honour a link exactly as
// the kiosk page does (same function), refuse expired / revoked / unbound-owner / foreign / wall links,
// take the org from the token alone, and never hand a stranger the agent's prose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));
const state = vi.hoisted(() => ({ db: true, revoked: false, role: "owner" as string | null, pulse: null as unknown }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => state.db }));
vi.mock("@/lib/db/org-share", () => ({ isLiveShareRevoked: vi.fn(async () => state.revoked) }));
vi.mock("@/lib/db/members", () => ({
  getMembershipRole: vi.fn(async () => state.role),
  roleAtLeast: (role: string | null, min: string) => role === min || role === "owner",
}));
vi.mock("@/lib/db/loop-pulse", () => ({ getLoopPulse: vi.fn(async () => state.pulse) }));

import { createHmac } from "node:crypto";
import { GET } from "./route";
import { getLoopPulse } from "@/lib/db/loop-pulse";
import { signLiveShareToken } from "@/lib/live-share";
import { fixtureLane, fixturePulse, fixtureRunner } from "@/features/inflight/live/theater/theaterFixture";

const SECRET = "test-live-pulse-secret";
const get = (token: string | null) => GET(new Request(`http://localhost/api/live/pulse${token == null ? "" : `?token=${encodeURIComponent(token)}`}`));
const theaterToken = (opts: { ttlMs?: number; mintedBy?: string } = {}) => signLiveShareToken("acme", { view: "theater", ...opts })!.token;

beforeEach(() => {
  vi.stubEnv("LIVE_SHARE_SECRET", SECRET);
  vi.stubEnv("AUTH_SECRET", "");
  Object.assign(state, { db: true, revoked: false, role: "owner", pulse: null });
  vi.mocked(getLoopPulse).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/live/pulse", () => {
  it("serves the org's pulse for a theater link — the org comes from the token", async () => {
    state.pulse = fixturePulse();
    const res = await get(theaterToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getLoopPulse).toHaveBeenCalledWith("acme");
    expect(((await res.json()) as { pulse: { org: string } }).pulse.org).toBe("acme");
  });

  it("strips every lane activity note, every repo note and every prose headline — paths and phases stay", async () => {
    state.pulse = fixturePulse({
      runner: fixtureRunner({ repos: [{ repo: "acme/kp", baseBranch: "main", paused: "branch-conflict", pausedUntil: null, note: "conflict in src/secret.ts", failureStreak: 0, dryStreak: 0, lastMergeInSha: null, lastLandedSha: null, aheadOfBase: 1 }] }),
      lanes: [fixtureLane()],
      latest: [
        { at: "2026-09-18T12:00:00Z", repo: "acme/web", kind: "plan-pending", headline: "Move billing secrets into the vault module" },
        { at: "2026-09-18T11:59:00Z", repo: "acme/kp", kind: "failed", headline: "ENOENT: /home/ops/.npmrc" },
      ],
    });
    const body = ((await (await get(theaterToken())).json()) as { pulse: ReturnType<typeof fixturePulse> }).pulse;
    expect(body.latest).toEqual([
      { at: "2026-09-18T12:00:00Z", repo: "acme/web", kind: "plan-pending", headline: "A plan waits for approval" },
      { at: "2026-09-18T11:59:00Z", repo: "acme/kp", kind: "failed", headline: "A lane failed" },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/vault module|\.npmrc|src\/secret\.ts/);
    const tail = body.lanes[0]!.tail;
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((t) => t.note === null)).toBe(true);
    expect(tail.map((t) => t.path)).toEqual(fixtureLane().tail.map((t) => t.path));
    expect(body.lanes[0]!.phase).toBe("agent-editing");
    expect(body.runner!.repos[0]).toMatchObject({ repo: "acme/kp", paused: "branch-conflict", note: null });
    expect(JSON.stringify(body)).not.toContain("Tighten the claim table");
  });

  it("answers { pulse: null } when there is nothing to report", async () => {
    expect(await (await get(theaterToken())).json()).toEqual({ pulse: null });
  });

  it("refuses a WALL link (every link minted before the theater) — it was never granted the runner", async () => {
    expect((await get(signLiveShareToken("acme")!.token)).status).toBe(403);
    expect(getLoopPulse).not.toHaveBeenCalled();
  });

  it("refuses an expired link", async () => {
    expect((await get(theaterToken({ ttlMs: -1 }))).status).toBe(403);
  });

  it("refuses a revoked link, and fails closed when the revocation lookup errors", async () => {
    state.revoked = true;
    expect((await get(theaterToken())).status).toBe(403);
    state.revoked = false;
    const { isLiveShareRevoked } = await import("@/lib/db/org-share");
    vi.mocked(isLiveShareRevoked).mockRejectedValueOnce(new Error("db blip"));
    expect((await get(theaterToken())).status).toBe(403);
  });

  it("refuses a link whose minting owner lost owner access", async () => {
    state.role = "member";
    expect((await get(theaterToken({ mintedBy: "kaz" }))).status).toBe(403);
  });

  it("refuses foreign tokens: another secret, a session-cookie-shaped HMAC, garbage, none", async () => {
    const payload = Buffer.from(JSON.stringify({ aud: "live-share.v1", org: "acme", jti: "j", exp: Date.now() + 60_000, view: "theater" })).toString("base64url");
    const otherSecret = createHmac("sha256", "someone-else").update(`live-share.v1.${payload}`).digest("base64url");
    const noDomain = createHmac("sha256", SECRET).update(payload).digest("base64url");
    for (const t of [`${payload}.${otherSecret}`, `${payload}.${noDomain}`, "garbage", null]) {
      expect((await get(t)).status).toBe(403);
    }
    expect(getLoopPulse).not.toHaveBeenCalled();
  });

  it("a failed read is a 500, never a pulse of zeros", async () => {
    vi.mocked(getLoopPulse).mockRejectedValueOnce(new Error("db down"));
    expect((await get(theaterToken())).status).toBe(500);
  });

  it("answers 503 on a deployment with no database", async () => {
    state.db = false;
    expect((await get(theaterToken())).status).toBe(503);
  });
});
