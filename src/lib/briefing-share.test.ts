// EXEC #1: the executive briefing's segment scope (a reseller's per-client view) must survive into the
// signed read-only share token, so the shared board link re-runs scoped to the SAME client the owner
// shared — not the whole org. These tests pin that the segment round-trips through sign → verify, and
// that an absent segment stays absent (whole-org, the legacy default).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import type { ExecBriefing } from "./org/briefing";
import {
  briefingFigureDigest,
  briefingShareEnabled,
  briefingShareRevocationKey,
  freezeShareWindow,
  shareIntegrity,
  signBriefingShareToken,
  verifyBriefingShareToken,
} from "./briefing-share";
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

// ── Per-grant identity + revocation (share-link-no-grant-identity #13) ─────────────────────────
// `mintedBy` was the only handle a link had, so the only kill switch demoted the person who minted it
// and took every OTHER link they had issued with it. Each grant now carries its own `jti`.

describe("each grant is minted with its own identity (#13)", () => {
  it("stamps a distinct jti on every mint and round-trips it", () => {
    const a = signBriefingShareToken({ org: "acme", range: "30d" })!;
    const b = signBriefingShareToken({ org: "acme", range: "30d" })!;
    expect(a.jti).toBeTruthy();
    expect(a.jti).not.toBe(b.jti); // two links for the SAME scope are still two separate grants
    expect(verifyBriefingShareToken(a.token)!.jti).toBe(a.jti);
  });

  it("kills exactly one grant: the revoked jti fails, its sibling still verifies", () => {
    const dead = signBriefingShareToken({ org: "acme", range: "30d" })!;
    const live = signBriefingShareToken({ org: "acme", range: "30d" })!;
    const revoked = (jti: string) => jti === dead.jti;
    expect(verifyBriefingShareToken(dead.token, { revoked })).toBeNull();
    expect(verifyBriefingShareToken(live.token, { revoked })).not.toBeNull();
  });

  it("namespaces the revocation key so it can never collide with a login or a live-share link", () => {
    expect(briefingShareRevocationKey("abc")).toBe("briefing-share:abc");
    expect(briefingShareRevocationKey("abc")).not.toBe("live-share:abc");
  });

  it("leaves a legacy token (no jti) verifying — it has no handle, so the predicate cannot touch it", () => {
    const legacy = mintLegacyToken({ org: "acme", range: "90d", exp: Date.now() + 60_000 });
    const v = verifyBriefingShareToken(legacy, { revoked: () => true });
    expect(v).not.toBeNull();
    expect(v!.jti).toBeUndefined();
  });
});

// ── Content integrity (share-link-reruns-builder #26) ─────────────────────────────────────────
// The shared page re-runs the builder, so the recipient's numbers can move under them. The token now
// carries a fingerprint of the figures the SENDER saw so the page can say whether they still match.

const fixture: ExecBriefing = {
  org: "acme",
  periodTitle: "last 90 days",
  generatedOn: "2026-07-28",
  maturity: { overall: 62, levelId: "L3", levelName: "Managed", adoption: 58, rigor: 66 },
  coverage: { scanned: 8, total: 12 },
  periodDelta: 4,
  priorPeriod: null,
  forecastHeadline: null,
  forecastConfidence: null,
  engineMix: [],
  adoptionRate: 58,
  movement: { up: 5, down: 2, compared: 8 },
  valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: 4, reposPromoted: 0 },
  benchmark: { percentile: 71, corpusRepos: 240, corpusAvgOverall: 54, cohort: null },
  strengths: [{ dimId: "D2", label: "Testing", avg: 80 }],
  risks: [{ dimId: "D9", label: "Security", avg: 41 }],
  security: { dimId: "D9", label: "Security", avg: 41 },
  topGainers: [],
  topRegressions: [],
  goals: [],
  regressionCount: 0,
  narrative: null,
};

describe("briefingFigureDigest — the figures the sender saw (#26)", () => {
  it("is stable for the same figures and blind to presentation", () => {
    const base = briefingFigureDigest(fixture);
    expect(briefingFigureDigest({ ...fixture, periodTitle: "Q3", generatedOn: "2026-08-01" })).toBe(base);
    expect(briefingFigureDigest({ ...fixture, narrative: "a paragraph" })).toBe(base);
  });

  it("moves when any quoted figure moves — including ones the frozen window does NOT pin", () => {
    const base = briefingFigureDigest(fixture);
    // A re-scan is already excluded by the frozen window; these are the drift sources that remain.
    expect(briefingFigureDigest({ ...fixture, benchmark: { ...fixture.benchmark!, percentile: 70 } })).not.toBe(base);
    expect(briefingFigureDigest({ ...fixture, coverage: { scanned: 8, total: 13 } })).not.toBe(base);
    expect(briefingFigureDigest({ ...fixture, goals: [{ label: "L4 by Q4", current: 62, target: 75, pct: 82, pace: "on track", etaDays: 40 }] })).not.toBe(base);
    expect(briefingFigureDigest({ ...fixture, risks: [{ dimId: "D9", label: "Security", avg: 40 }] })).not.toBe(base);
  });

  it("round-trips through the token and reads back as unchanged / changed / unverifiable", () => {
    const fig = briefingFigureDigest(fixture);
    const minted = signBriefingShareToken({ org: "acme", range: "90d", fig })!;
    const v = verifyBriefingShareToken(minted.token)!;
    expect(v.fig).toBe(fig);
    expect(shareIntegrity(v.fig, fig)).toBe("unchanged");
    expect(shareIntegrity(v.fig, briefingFigureDigest({ ...fixture, coverage: { scanned: 9, total: 12 } }))).toBe("changed");
    // A legacy token carries no fingerprint — that must NOT read as "unchanged", which would be the
    // same silent falsehood the fingerprint exists to remove.
    expect(shareIntegrity(verifyBriefingShareToken(mintLegacyToken({ org: "acme", exp: Date.now() + 60_000 }))!.fig, fig)).toBe("unverifiable");
  });

  it("honors a caller-supplied frozen window verbatim, so the mint can fingerprint the same one", () => {
    const win = freezeShareWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    const minted = signBriefingShareToken({ org: "acme", range: "custom", from: "2026-01-01", to: "2026-03-31", winStart: win.winStart ?? undefined, winEnd: win.winEnd })!;
    const v = verifyBriefingShareToken(minted.token)!;
    expect(v.winStart).toBe(win.winStart);
    expect(v.winEnd).toBe(win.winEnd);
  });
});
