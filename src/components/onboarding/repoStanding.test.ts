// first-run-onboarding-wizard#B (challenge-2026-09-23): the select step picks with each repo's
// standing in view. These pin the pure half: the wire-to-standing read, the chip label, the selection
// mix, the already-scheduled count, and the unscanned-first default selection.
//
// Critic revision: a repo whose latest scan was a PREVIEW (the deterministic mock) is never "unchanged:
// a rescan is free" and never counts as already covered. The live scan of it is still owed, and a
// live rescan of the same commit is not a no-op (dedup is engine-aware and upgrades the mock row).

import { describe, expect, it } from "vitest";
import type { OrgRepo, RepoStanding } from "./types";
import {
  alreadyScheduled,
  applyRunOverlay,
  isCovered,
  overlayFromRun,
  selectionMix,
  standingFromWire,
  standingLabel,
} from "./repoStanding";
import { MAX_SELECT, topSelection } from "./OnboardingFlow.model";
import { byProminence } from "./byProminence";

/** A row as the public listing sends it: no `standing` key at all. */
function withoutStanding(r: OrgRepo): OrgRepo {
  const copy = { ...r };
  delete copy.standing;
  return copy;
}

const WIRE = { watched: true, scanSchedule: "weekly", level: "L3", overall: 62, scannedAt: "2026-09-20T10:00:00.000Z", preview: false };

const standing = (over: Partial<RepoStanding> = {}): RepoStanding => ({
  level: "L3",
  overall: 62,
  watched: true,
  schedule: "weekly",
  scannedAt: "2026-09-20T10:00:00.000Z",
  preview: false,
  ...over,
});

const repo = (fullName: string, stars: number, over: Partial<OrgRepo> = {}): OrgRepo => ({
  fullName,
  private: true,
  language: null,
  stars,
  pushedAt: null,
  ...over,
});

describe("standingFromWire: the /api/app/repos `state` survives the normalize map", () => {
  it("maps a scanned row's state onto the standing the select step renders", () => {
    expect(standingFromWire(WIRE)).toEqual({
      level: "L3",
      overall: 62,
      watched: true,
      schedule: "weekly",
      scannedAt: "2026-09-20T10:00:00.000Z",
      preview: false,
    });
  });

  it("a row with state:null has standing:null", () => {
    expect(standingFromWire(null)).toBeNull();
    expect(standingFromWire(undefined)).toBeNull();
  });

  it("revision: carries the latest scan's preview flag", () => {
    expect(standingFromWire({ ...WIRE, preview: true })?.preview).toBe(true);
  });

  it("revision: a state that does not say which engine scored it is treated as a preview (never claimed free)", () => {
    const { preview: _drop, ...noEngine } = WIRE;
    void _drop;
    expect(standingFromWire(noEngine)?.preview).toBe(true);
  });
});

describe("standingLabel: the row chip", () => {
  it("a scanned row pushed after its scan says so", () => {
    expect(standingLabel(standing(), "2026-09-21T08:00:00.000Z")).toBe("L3 · 62 · pushed since last scan");
  });

  it("a scanned row not pushed since says a rescan is a free no-op", () => {
    expect(standingLabel(standing(), "2026-09-19T08:00:00.000Z")).toBe(
      "L3 · 62 · unchanged: a rescan returns the same score, free",
    );
    expect(standingLabel(standing(), "2026-09-20T10:00:00.000Z")).toBe(
      "L3 · 62 · unchanged: a rescan returns the same score, free",
    );
  });

  it("a row never scanned says so", () => {
    expect(standingLabel(null, "2026-09-21T08:00:00.000Z")).toBe("not scanned yet");
    expect(standingLabel(standing({ level: null, overall: null, scannedAt: null }), null)).toBe("not scanned yet");
  });

  it("revision: a preview-scanned row is never 'unchanged' nor 'free'", () => {
    const label = standingLabel(standing({ preview: true }), "2026-09-19T08:00:00.000Z");
    expect(label).toBe("L3 · 62 · preview estimate: the live scan has not run");
    expect(label).not.toMatch(/unchanged|free/);
  });

  it("claims nothing about change when either timestamp is unknown", () => {
    expect(standingLabel(standing(), null)).toBe("L3 · 62");
  });
});

describe("isCovered", () => {
  it("is a live-scored standing only", () => {
    expect(isCovered(standing())).toBe(true);
    expect(isCovered(standing({ preview: true }))).toBe(false);
    expect(isCovered(standing({ level: null }))).toBe(false);
    expect(isCovered(null)).toBe(false);
    expect(isCovered(undefined)).toBe(false);
  });
});

describe("topSelection: the 10 default slots go to what is not yet scanned", () => {
  // 12 repos; the 3 most-starred are already scored.
  const list = Array.from({ length: 12 }, (_, i) =>
    repo(`acme/r${i}`, 100 - i, i < 3 ? { standing: standing() } : { standing: null }),
  );

  it("the 9 unscanned repos by prominence, plus the most prominent scanned one", () => {
    const picked = topSelection(list);
    expect(picked.size).toBe(MAX_SELECT);
    expect([...picked].sort()).toEqual(
      ["acme/r0", "acme/r3", "acme/r4", "acme/r5", "acme/r6", "acme/r7", "acme/r8", "acme/r9", "acme/r10", "acme/r11"].sort(),
    );
    expect(picked.has("acme/r1")).toBe(false);
    expect(picked.has("acme/r2")).toBe(false);
  });

  it("with no standing on any row the result is today's prominence top-10", () => {
    const plain = list.map(withoutStanding);
    const today = new Set([...plain].sort(byProminence).slice(0, MAX_SELECT).map((r) => r.fullName));
    expect(topSelection(plain)).toEqual(today);
  });

  it("revision: a preview-scanned repo is NOT already covered, so it keeps its prominence slot", () => {
    const withPreview = list.map((r, i) => (i < 3 ? { ...r, standing: standing({ preview: true }) } : r));
    const today = new Set([...withPreview].sort(byProminence).slice(0, MAX_SELECT).map((r) => r.fullName));
    expect(topSelection(withPreview)).toEqual(today);
    expect(topSelection(withPreview).has("acme/r1")).toBe(true);
  });
});

describe("selectionMix and alreadyScheduled", () => {
  const repos = [
    repo("a/1", 5, { standing: null }),
    repo("a/2", 4, { standing: null }),
    repo("a/3", 3, { standing: null }),
    repo("a/4", 2, { standing: standing() }),
    repo("a/5", 1, { standing: standing({ schedule: "off", watched: false }) }),
    repo("a/6", 0, { standing: standing({ preview: true }) }),
  ];

  it("counts new picks and rescans over the selection only", () => {
    expect(selectionMix(new Set(["a/1", "a/2", "a/3", "a/4", "a/5"]), repos)).toEqual({ fresh: 3, rescans: 2 });
    expect(selectionMix(new Set(["a/1", "a/4"]), repos)).toEqual({ fresh: 1, rescans: 1 });
  });

  it("revision: a preview-scanned pick counts as new, not a rescan", () => {
    expect(selectionMix(new Set(["a/6"]), repos)).toEqual({ fresh: 1, rescans: 0 });
  });

  it("is null on a listing that carries no standing at all (the public-handle path)", () => {
    const plain = repos.map(withoutStanding);
    expect(selectionMix(new Set(["a/1"]), plain)).toBeNull();
  });

  it("counts the selected repos already watched on the weekly autoscan", () => {
    expect(alreadyScheduled(new Set(["a/1", "a/4", "a/5", "a/6"]), repos, "weekly")).toBe(2);
    expect(alreadyScheduled(new Set(["a/1"]), repos, "weekly")).toBe(0);
  });
});

describe("overlayFromRun / applyRunOverlay: the finished run outlives the 30s listing cache", () => {
  const AT = "2026-09-22T12:00:00.000Z";
  const rows = {
    "a/1": { repo: "a/1", level: "L4" as const, overall: 80 },
    "a/2": { repo: "a/2", error: "boom" },
    "a/3": { repo: "a/3", skipped: "monthly_quota" },
    "a/4": { repo: "a/4", completed: true },
  };

  it("records only scored rows, preview from the plan, and a missing plan reads as a preview", () => {
    const live = overlayFromRun(rows, { mock: false, watch: false, schedule: undefined }, [], AT);
    expect(Object.keys(live)).toEqual(["a/1"]);
    expect(live["a/1"]).toEqual({ level: "L4", overall: 80, watched: false, schedule: "off", scannedAt: AT, preview: false });
    expect(overlayFromRun(rows, null, [], AT)["a/1"]!.preview).toBe(true);
    expect(overlayFromRun(rows, { mock: false, watch: true, schedule: undefined }, [], AT)["a/1"]).toMatchObject({
      watched: true,
      schedule: "weekly",
    });
  });

  it("wins over an older (cached) listing, and yields to a listing that has caught up", () => {
    const overlay = { "a/1": standing({ level: "L4", overall: 80, scannedAt: AT }) };
    const stale = [repo("a/1", 1, { standing: null }), repo("a/9", 1, { standing: null })];
    expect(applyRunOverlay(stale, overlay)[0]!.standing).toMatchObject({ level: "L4", overall: 80 });
    expect(applyRunOverlay(stale, overlay)[1]!.standing).toBeNull();
    const fresher = [repo("a/1", 1, { standing: standing({ level: "L5", scannedAt: "2026-09-23T00:00:00.000Z" }) })];
    expect(applyRunOverlay(fresher, overlay)[0]!.standing!.level).toBe("L5");
  });
});
