// buildOrgRework (W5) — the pure fold behind the Debt Ledger's quality half. Pins the legacy-blob
// discipline (a pre-W5 blob lacks the rework keys → measured:false + null rates; a W5 blob below the
// sample floor stores an explicit null → measured:true + null rates — the two must stay
// distinguishable, they carry different UI copy), the analyzed-PR weighting, and the sort order
// (worst measured rework first, unmeasured last — absence is not the fleet's best row).

import { describe, expect, it } from "vitest";
import { buildOrgRework, type ReworkScanRow } from "./org-rework";

/** A W5-era prStats blob (carries the rework keys, possibly as explicit nulls). */
function w5Blob(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    analyzed: 20,
    merged: 15,
    aiInvolvedRate: 40,
    revertRate: 5,
    aiTrailerRate: 30,
    reworkRate: 10,
    aiReworkRate: 12,
    ...over,
  });
}

/** A pre-W5 blob: the rework keys simply do not exist (written before the fields did). */
function legacyBlob(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ analyzed: 10, merged: 8, aiInvolvedRate: 20, revertRate: 3, ...over });
}

const row = (fullName: string, prStats: string | null): ReworkScanRow => ({
  fullName,
  name: fullName.split("/")[1]!,
  prStats,
});

describe("buildOrgRework — legacy vs measured blobs", () => {
  it("a pre-W5 blob reads measured:false with null rework rates — never a fabricated 0", () => {
    const out = buildOrgRework([row("acme/old", legacyBlob())])!;
    const r = out.perRepo[0]!;
    expect(r.measured).toBe(false);
    expect(r.reworkRate).toBeNull();
    expect(r.aiReworkRate).toBeNull();
    expect(r.revertRate).toBe(3); // W1a field exists on the legacy blob and survives
    expect(out.avgReworkRate).toBeNull(); // no repo carries a sample → fleet rate is null too
    expect(out.measuredRepos).toBe(0);
  });

  it("a W5 blob below the sample floor (explicit null) reads measured:true with null rates", () => {
    const out = buildOrgRework([row("acme/tiny", w5Blob({ reworkRate: null, aiReworkRate: null }))])!;
    const r = out.perRepo[0]!;
    expect(r.measured).toBe(true); // the scan tracked rework; the sample was just too small
    expect(r.reworkRate).toBeNull();
    expect(out.measuredRepos).toBe(1);
  });

  it("skips malformed and empty blobs without throwing; returns null when nothing is usable", () => {
    expect(buildOrgRework([row("a/b", "{not json"), row("c/d", null)])).toBeNull();
    expect(buildOrgRework([])).toBeNull();
  });

  it("a garbage (non-numeric) rate on a drifted blob reads null, not NaN", () => {
    const out = buildOrgRework([row("acme/drift", w5Blob({ reworkRate: "12%" }))])!;
    expect(out.perRepo[0]!.reworkRate).toBeNull();
    expect(out.avgReworkRate).toBeNull();
  });
});

describe("buildOrgRework — weighting and sort", () => {
  it("weights fleet rates by analyzed PR count and excludes null contributors from the weight", () => {
    const out = buildOrgRework([
      row("acme/big", w5Blob({ analyzed: 90, reworkRate: 20 })),
      row("acme/small", w5Blob({ analyzed: 10, reworkRate: 0 })),
      row("acme/legacy", legacyBlob({ analyzed: 400 })), // no rework key — must add NO weight
    ])!;
    // (20*90 + 0*10) / 100 = 18 — the 400-PR legacy repo does not drag the mean toward anything.
    expect(out.avgReworkRate).toBe(18);
    expect(out.repos).toBe(3);
    expect(out.measuredRepos).toBe(2);
    expect(out.totalPrs).toBe(500);
  });

  it("sorts worst measured rework first and unmeasured (pre-W5) rows last", () => {
    const out = buildOrgRework([
      row("acme/legacy", legacyBlob()),
      row("acme/calm", w5Blob({ reworkRate: 2 })),
      row("acme/hot", w5Blob({ reworkRate: 30 })),
    ])!;
    expect(out.perRepo.map((r) => r.name)).toEqual(["hot", "calm", "legacy"]);
  });

  it("exposes the trailer-grounded exposure and its fallback separately per repo", () => {
    const out = buildOrgRework([row("acme/x", w5Blob({ aiTrailerRate: null, aiInvolvedRate: 55 }))])!;
    const r = out.perRepo[0]!;
    expect(r.aiTrailerRate).toBeNull();
    expect(r.aiInvolvedRate).toBe(55);
  });
});
