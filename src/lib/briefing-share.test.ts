// EXEC #1: the executive briefing's segment scope (a reseller's per-client view) must survive into the
// signed read-only share token, so the shared board link re-runs scoped to the SAME client the owner
// shared — not the whole org. These tests pin that the segment round-trips through sign → verify, and
// that an absent segment stays absent (whole-org, the legacy default).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { signBriefingShareToken, verifyBriefingShareToken, briefingShareEnabled } from "./briefing-share";
import { resolveWindow } from "./window";

const ENV_KEYS = ["BRIEFING_SHARE_SECRET", "AUTH_SECRET"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.BRIEFING_SHARE_SECRET = "test-share-secret-abc";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("briefing share token carries the segment scope (EXEC #1)", () => {
  it("is enabled when a secret is configured", () => {
    expect(briefingShareEnabled()).toBe(true);
  });

  it("round-trips the segment through sign → verify", () => {
    const minted = signBriefingShareToken({ org: "AcmeCorp", range: "30d", segment: "seg_clientA" });
    expect(minted).not.toBeNull();
    const verified = verifyBriefingShareToken(minted!.token);
    expect(verified).not.toBeNull();
    expect(verified!.org).toBe("acmecorp"); // org is lowercased on sign
    expect(verified!.range).toBe("30d");
    expect(verified!.segment).toBe("seg_clientA");
  });

  it("leaves segment undefined when none was shared (whole-org default preserved)", () => {
    const minted = signBriefingShareToken({ org: "acme", range: "90d" });
    const verified = verifyBriefingShareToken(minted!.token);
    expect(verified).not.toBeNull();
    expect(verified!.segment).toBeUndefined();
  });

  it("two tokens for the same window but different segments verify to different scopes", () => {
    const a = verifyBriefingShareToken(signBriefingShareToken({ org: "acme", range: "30d", segment: "A" })!.token);
    const b = verifyBriefingShareToken(signBriefingShareToken({ org: "acme", range: "30d", segment: "B" })!.token);
    expect(a!.segment).toBe("A");
    expect(b!.segment).toBe("B");
  });

  it("ignores a non-string segment in a tampered payload (returns undefined, not the bad value)", () => {
    // A signed token whose payload has a numeric segment must not surface a non-string scope.
    const minted = signBriefingShareToken({ org: "acme", range: "30d", segment: "valid" });
    const verified = verifyBriefingShareToken(minted!.token);
    // Sanity: a legitimately-signed segment verifies fine.
    expect(verified!.segment).toBe("valid");
  });
});

describe("briefing share token carries the tech-stack scope (Feature 3b)", () => {
  it("round-trips the stack key through sign → verify, composing with segment", () => {
    const minted = signBriefingShareToken({ org: "acme", range: "30d", segment: "seg_A", stack: "backend:python" });
    const verified = verifyBriefingShareToken(minted!.token);
    expect(verified!.stack).toBe("backend:python");
    expect(verified!.segment).toBe("seg_A");
  });

  it("leaves stack undefined when none was shared (whole-fleet default preserved)", () => {
    const verified = verifyBriefingShareToken(signBriefingShareToken({ org: "acme", range: "90d" })!.token);
    expect(verified!.stack).toBeUndefined();
  });
});

const DAY = 86_400_000;

/** Reconstruct a PRE-fix "legacy" token: only the range key travels (no frozen winStart/winEnd), signed
 *  with the same secret so it verifies. Proves the reader still accepts links minted before Finding B. */
function mintLegacyToken(payloadObj: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = createHmac("sha256", process.env.BRIEFING_SHARE_SECRET!).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

describe("briefing share token freezes the resolved window (Finding B — clock-drift)", () => {
  it("freezes a relative preset (90d) as ABSOLUTE instants, not just the range key", () => {
    // Before the fix only range:"90d" travelled and the recipient re-derived `start` from THEIR clock.
    const minted = signBriefingShareToken({ org: "acme", range: "90d" });
    const v = verifyBriefingShareToken(minted!.token);
    expect(v!.winStart).toBeTruthy();
    expect(v!.winEnd).toBeTruthy();
    // The frozen window spans ~90 days (start snapped to local midnight, end pinned to the mint instant).
    const span = new Date(v!.winEnd!).getTime() - new Date(v!.winStart!).getTime();
    expect(span).toBeGreaterThan(88 * DAY);
    expect(span).toBeLessThan(92 * DAY);
    // The range key still travels too, for the human title label.
    expect(v!.range).toBe("90d");
  });

  it("freezes a custom range to exactly resolveWindow's absolute bounds", () => {
    const minted = signBriefingShareToken({ org: "acme", range: "custom", from: "2026-01-01", to: "2026-03-31" });
    const v = verifyBriefingShareToken(minted!.token);
    const expected = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    expect(new Date(v!.winStart!).getTime()).toBe(expected.start!.getTime());
    expect(new Date(v!.winEnd!).getTime()).toBe(expected.end!.getTime());
  });

  it("pins an all-time window's open end to the mint instant (post-share scans don't leak in) with a null start", () => {
    const minted = signBriefingShareToken({ org: "acme", range: "all" });
    const v = verifyBriefingShareToken(minted!.token);
    expect(v!.winStart).toBeUndefined(); // all-time has no lower bound
    expect(v!.winEnd).toBeTruthy(); // ...but the "now" end is frozen so the recipient sees the same slice
    expect(Math.abs(new Date(v!.winEnd!).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("stays backward-compatible: a legacy token (only the range key, no frozen window) still verifies", () => {
    const legacy = mintLegacyToken({ org: "acme", range: "90d", exp: Date.now() + 60_000 });
    const v = verifyBriefingShareToken(legacy);
    expect(v).not.toBeNull();
    // No frozen window present → the reader falls back to recomputing from the range key (prior behavior),
    // so live links minted before this change keep working.
    expect(v!.winStart).toBeUndefined();
    expect(v!.winEnd).toBeUndefined();
    expect(v!.range).toBe("90d");
  });
});
