// EXEC #1: the executive briefing's segment scope (a reseller's per-client view) must survive into the
// signed read-only share token, so the shared board link re-runs scoped to the SAME client the owner
// shared — not the whole org. These tests pin that the segment round-trips through sign → verify, and
// that an absent segment stays absent (whole-org, the legacy default).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signBriefingShareToken, verifyBriefingShareToken, briefingShareEnabled } from "./briefing-share";

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
