// The one repo-history read ladder (/trends, /report/compare, /api/history): a pure decision over
// injected reads, so every surface answers the same states at the same depth.

import { describe, expect, it, vi } from "vitest";
import {
  historyReturnPath,
  resolveRepoHistoryAccess,
  type RepoHistoryDeps,
} from "@/lib/history/repoHistoryAccess";
import { repoHistoryNotice } from "@/lib/history/repoHistoryNotice";
import { HISTORY_SCAN_CAP } from "@/lib/history/limits";
import { NO_HISTORY_WINDOW, type HistoryWindow } from "@/lib/history/window";

type Series = { scans: { id: string }[] };
const series = (n: number): Series => ({ scans: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })) });
const WINDOW: HistoryWindow = { since: new Date("2026-09-22T00:00:00.000Z"), days: 30, planLabel: "Free" };

function deps(over: Partial<RepoHistoryDeps<Series>> = {}) {
  const d = {
    dbConfigured: true,
    resolveOrg: vi.fn(async () => "public"),
    resolveWindow: vi.fn(async () => NO_HISTORY_WINDOW),
    read: vi.fn(async () => series(2) as Series | null),
    probe: vi.fn(async () => 0),
    ...over,
  };
  return d;
}

describe("resolveRepoHistoryAccess - the request prelude", () => {
  it("missing, invalid and no-db answer before any read", async () => {
    const d = deps();
    expect(await resolveRepoHistoryAccess({ repo: undefined, surface: "trends", deps: d })).toEqual({ kind: "missing-repo" });
    expect(await resolveRepoHistoryAccess({ repo: "not a repo", surface: "trends", deps: d })).toEqual({ kind: "invalid-repo" });
    const off = deps({ dbConfigured: false });
    expect(await resolveRepoHistoryAccess({ repo: "o/r", surface: "trends", deps: off })).toMatchObject({ kind: "no-db", repo: "o/r" });
    expect(d.read).toHaveBeenCalledTimes(0);
    expect(off.read).toHaveBeenCalledTimes(0);
    expect(off.resolveOrg).toHaveBeenCalledTimes(0);
  });
});

describe("resolveRepoHistoryAccess - the read", () => {
  it("a DB_UNAVAILABLE error is db-down; any other error propagates", async () => {
    const down = deps({ read: vi.fn(async () => { throw Object.assign(new Error("down"), { code: "DB_UNAVAILABLE" }); }) });
    expect(await resolveRepoHistoryAccess({ repo: "o/r", surface: "trends", deps: down })).toMatchObject({ kind: "db-down", repo: "o/r" });
    const windowDown = deps({ resolveWindow: vi.fn(async () => { throw { code: "DB_UNAVAILABLE" }; }) });
    expect(await resolveRepoHistoryAccess({ repo: "o/r", surface: "compare", deps: windowDown })).toMatchObject({ kind: "db-down" });
    const other = deps({ read: vi.fn(async () => { throw new Error('relation "Scan" does not exist'); }) });
    await expect(resolveRepoHistoryAccess({ repo: "o/r", surface: "trends", deps: other })).rejects.toThrow(/relation/);
  });

  it("an empty windowed read with older scans is outside-window; with none it is empty", async () => {
    const hidden = deps({ resolveWindow: vi.fn(async () => WINDOW), read: vi.fn(async () => series(0)), probe: vi.fn(async () => 1) });
    expect(await resolveRepoHistoryAccess({ repo: "o/r", surface: "trends", deps: hidden })).toMatchObject({ kind: "outside-window", window: WINDOW });
    expect(hidden.probe).toHaveBeenCalledWith({ owner: "o", repo: "r", orgSlug: "public" });
    const none = deps({ resolveWindow: vi.fn(async () => WINDOW), read: vi.fn(async () => null), probe: vi.fn(async () => 0) });
    expect(await resolveRepoHistoryAccess({ repo: "o/r", surface: "trends", deps: none })).toMatchObject({ kind: "empty", window: WINDOW });
  });

  it("with no window the probe is never called", async () => {
    const d = deps({ read: vi.fn(async () => series(0)) });
    expect(await resolveRepoHistoryAccess({ repo: "o/r", surface: "compare", deps: d })).toMatchObject({ kind: "empty" });
    expect(d.probe).toHaveBeenCalledTimes(0);
  });

  it("ok carries the org, the window and the data; the read gets the window's since", async () => {
    const d = deps({ resolveOrg: vi.fn(async () => "acme"), resolveWindow: vi.fn(async () => WINDOW) });
    const s = await resolveRepoHistoryAccess({ repo: "https://github.com/o/r", surface: "trends", deps: d });
    expect(s).toMatchObject({ kind: "ok", repo: "o/r", orgSlug: "acme", window: WINDOW, data: series(2) });
    expect(d.resolveOrg).toHaveBeenCalledWith("o");
    expect(d.resolveWindow).toHaveBeenCalledWith("acme");
    expect(d.read.mock.calls[0]).toEqual([{ owner: "o", repo: "r", orgSlug: "acme", limit: HISTORY_SCAN_CAP, since: WINDOW.since }]);
  });
});

describe("one depth for trends and compare", () => {
  it("compare reads at HISTORY_SCAN_CAP (200), the same depth as trends, not 60", async () => {
    const trends = deps();
    const compare = deps();
    await resolveRepoHistoryAccess({ repo: "o/r", surface: "trends", deps: trends });
    await resolveRepoHistoryAccess({ repo: "o/r", surface: "compare", deps: compare });
    expect(HISTORY_SCAN_CAP).toBe(200);
    expect(compare.read.mock.calls[0]![0]).toMatchObject({ limit: HISTORY_SCAN_CAP });
    expect(compare.read.mock.calls[0]![0].limit).toBe(trends.read.mock.calls[0]![0].limit);
  });

  it("the api surface passes the caller's limit through, and none when it gave none", async () => {
    const d = deps();
    await resolveRepoHistoryAccess({ repo: "o/r", surface: "api", limit: 45, deps: d });
    await resolveRepoHistoryAccess({ repo: "o/r", surface: "api", deps: d });
    expect(d.read.mock.calls.map((c) => c[0].limit)).toEqual([45, undefined]);
  });
});

describe("historyReturnPath", () => {
  it("compare keeps the whole pair through sign-in", () => {
    expect(historyReturnPath("compare", { repo: "o/r", a: "s1", b: "s2", against: "org:best" })).toBe(
      "/report/compare?repo=o%2Fr&a=s1&b=s2&against=org%3Abest",
    );
    expect(historyReturnPath("compare", { repo: "o/r" })).toBe("/report/compare?repo=o%2Fr");
    expect(historyReturnPath("compare", {})).toBe("/report/compare");
  });

  it("trends keeps the repo", () => {
    expect(historyReturnPath("trends", { repo: "o/r" })).toBe("/trends?repo=o%2Fr");
    expect(historyReturnPath("trends", {})).toBe("/trends");
  });
});

describe("repoHistoryNotice - copy single-sourced", () => {
  it("empty shares the title with a surface-specific tail", () => {
    const t = repoHistoryNotice({ kind: "empty" }, "trends", "o/r");
    const c = repoHistoryNotice({ kind: "empty" }, "compare", "o/r");
    expect(t.title).toBe("No scans recorded yet");
    expect(c.title).toBe(t.title);
    expect(t.body).toMatch(/to start the trend\.$/);
    expect(c.body).toMatch(/to start tracking changes\.$/);
  });

  it("db-down reads the same on both surfaces", () => {
    for (const surface of ["trends", "compare"] as const) {
      const n = repoHistoryNotice({ kind: "db-down" }, surface, "o/r");
      expect(n.title).toBe("Scan history is unavailable right now");
      expect(n.body).toContain("o/r");
      expect(n.repo).toBe("o/r");
    }
  });

  it("outside-window names the plan window; no notice carries an em dash", () => {
    const states = [
      { kind: "missing-repo" }, { kind: "invalid-repo" }, { kind: "no-db" }, { kind: "db-down" }, { kind: "empty" },
      { kind: "outside-window", window: WINDOW },
    ] as const;
    expect(repoHistoryNotice(states[5], "compare", "o/r").body).toMatch(/older than the last 30 days/);
    for (const surface of ["trends", "compare"] as const) {
      for (const s of states) {
        const n = repoHistoryNotice(s, surface, "o/r");
        expect(n.title + n.body).not.toContain(String.fromCharCode(0x2014));
      }
    }
    expect(repoHistoryNotice({ kind: "missing-repo" }, "trends", undefined).repo).toBeUndefined();
  });
});
