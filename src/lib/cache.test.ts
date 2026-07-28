// Unit tests for the in-flight scan coalescer (bug-hunt finding scan-pipeline #1): concurrent scans of
// the same uncached commit must share ONE run, and the refcounted abort must cancel the shared scan
// only when the LAST interested caller disconnects — so one client navigating away can't kill a scan
// the others still want.

import { describe, it, expect, vi } from "vitest";
import {
  activeScoringIdentity,
  coalesceScan,
  inflightScanCount,
  makeCacheKey,
  normalizeRepoName,
  type ScoringIdentity,
} from "./cache";
import type { ScanProgress, ScanReport } from "@/lib/types";

const fakeReport = (id: string) => ({ id }) as unknown as ScanReport;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("coalesceScan — in-flight scan de-duplication (scan-pipeline #1)", () => {
  it("runs the factory once for concurrent same-key calls and shares the result", async () => {
    const d = deferred<ScanReport>();
    const factory = vi.fn(() => d.promise);

    const a = coalesceScan("repo@sha::llm", factory);
    const b = coalesceScan("repo@sha::llm", factory);

    expect(factory).toHaveBeenCalledTimes(1); // second caller joined, didn't start a new scan
    expect(inflightScanCount()).toBe(1);

    d.resolve(fakeReport("r"));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb); // both callers get the same report
    expect(inflightScanCount()).toBe(0); // evicted once settled
  });

  it("re-runs the factory for a new call after the previous run settled", async () => {
    const factory = vi.fn(async () => fakeReport("r"));
    await coalesceScan("repo2::llm", factory);
    await coalesceScan("repo2::llm", factory); // prior run already evicted → fresh run
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("aborts the shared scan only when the LAST waiter aborts (refcount)", async () => {
    const d = deferred<ScanReport>();
    let captured: AbortSignal | undefined;
    const factory = vi.fn((signal: AbortSignal) => {
      captured = signal;
      return d.promise;
    });
    const c1 = new AbortController();
    const c2 = new AbortController();

    const p1 = coalesceScan("repo3::llm", factory, c1.signal);
    const p2 = coalesceScan("repo3::llm", factory, c2.signal);
    expect(factory).toHaveBeenCalledTimes(1);

    c1.abort();
    expect(captured?.aborted).toBe(false); // one interested caller remains → keep scanning

    c2.abort();
    expect(captured?.aborted).toBe(true); // last caller gone → shared scan aborted

    d.reject(new Error("aborted"));
    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
    expect(inflightScanCount()).toBe(0);
  });

  // Joiner metering (ambiguity-ui scan-pipeline-ingestion #4): the scan routes consume a monthly
  // quota slot BEFORE coalescing, so they need to know "I joined" vs "I computed" to refund the
  // joiner's slot — otherwise a double-mount / two-tabs race double-charges one shared computation.
  it("fires onJoin for JOINERS only, never for the computing owner", async () => {
    const d = deferred<ScanReport>();
    const factory = vi.fn(() => d.promise);
    const ownerJoin = vi.fn();
    const joinerJoin = vi.fn();

    const a = coalesceScan("repo4::llm", factory, undefined, ownerJoin);
    const b = coalesceScan("repo4::llm", factory, undefined, joinerJoin);

    expect(ownerJoin).not.toHaveBeenCalled(); // first caller computed — its slot stands
    expect(joinerJoin).toHaveBeenCalledTimes(1); // second caller joined — its slot is refundable

    d.resolve(fakeReport("r"));
    await Promise.all([a, b]);

    // After settle+evict, a fresh call computes again → no onJoin.
    const again = vi.fn();
    await coalesceScan("repo4::llm", vi.fn(async () => fakeReport("r2")), undefined, again);
    expect(again).not.toHaveBeenCalled();
  });

  // Progress fan-out (G3-21): the factory's onProgress only ever runs for the caller that STARTED the
  // shared scan, so a joined caller used to receive nothing between joining and the final result — a
  // multi-minute scan that looked completely stalled to every joiner.
  describe("progress fan-out to joined callers", () => {
    const frame = (pct: number, message = "working") =>
      ({ stage: "analyze", message, pct }) as ScanProgress;

    it("delivers the OWNER's progress frames to every joined caller", async () => {
      const d = deferred<ScanReport>();
      let emit!: (p: ScanProgress) => void;
      const factory = vi.fn((_signal: AbortSignal, e: (p: ScanProgress) => void) => {
        emit = e;
        return d.promise;
      });
      const ownerSeen: ScanProgress[] = [];
      const joinerSeen: ScanProgress[] = [];

      const a = coalesceScan("p1::llm", factory, undefined, undefined, (p) => ownerSeen.push(p));
      const b = coalesceScan("p1::llm", factory, undefined, undefined, (p) => joinerSeen.push(p));

      emit(frame(40));
      emit(frame(80));

      expect(ownerSeen.map((p) => p.pct)).toEqual([40, 80]);
      expect(joinerSeen.map((p) => p.pct)).toEqual([40, 80]); // the joiner is no longer blind

      d.resolve(fakeReport("r"));
      await Promise.all([a, b]);
    });

    it("REPLAYS the latest frame to a LATE joiner (its UI starts where the shared scan is)", async () => {
      const d = deferred<ScanReport>();
      let emit!: (p: ScanProgress) => void;
      const factory = vi.fn((_s: AbortSignal, e: (p: ScanProgress) => void) => {
        emit = e;
        return d.promise;
      });
      const owner = coalesceScan("p2::llm", factory, undefined, undefined, () => {});
      emit(frame(30));
      emit(frame(60, "scoring"));

      const lateSeen: ScanProgress[] = [];
      const late = coalesceScan("p2::llm", factory, undefined, undefined, (p) => lateSeen.push(p));

      // Exactly the last frame, not the whole history — the client only needs where the scan IS.
      expect(lateSeen).toEqual([frame(60, "scoring")]);

      emit(frame(90));
      expect(lateSeen.map((p) => p.pct)).toEqual([60, 90]); // and it keeps receiving live frames

      d.resolve(fakeReport("r"));
      await Promise.all([owner, late]);
    });

    it("one caller's THROWING sink can't break the shared scan or starve the others", async () => {
      const d = deferred<ScanReport>();
      let emit!: (p: ScanProgress) => void;
      const factory = vi.fn((_s: AbortSignal, e: (p: ScanProgress) => void) => {
        emit = e;
        return d.promise;
      });
      const healthy: ScanProgress[] = [];
      const a = coalesceScan("p3::llm", factory, undefined, undefined, () => {
        throw new Error("SSE controller closed"); // a client that already disconnected
      });
      const b = coalesceScan("p3::llm", factory, undefined, undefined, (p) => healthy.push(p));

      expect(() => emit(frame(50))).not.toThrow();
      expect(healthy.map((p) => p.pct)).toEqual([50]);

      d.resolve(fakeReport("r"));
      await Promise.all([a, b]);
    });

    it("stops feeding a caller that aborted, while the shared scan keeps running for the rest", async () => {
      const d = deferred<ScanReport>();
      let emit!: (p: ScanProgress) => void;
      const factory = vi.fn((_s: AbortSignal, e: (p: ScanProgress) => void) => {
        emit = e;
        return d.promise;
      });
      const gone: ScanProgress[] = [];
      const stays: ScanProgress[] = [];
      const c = new AbortController();

      const leaving = coalesceScan("p4::llm", factory, c.signal, undefined, (p) => gone.push(p));
      const staying = coalesceScan("p4::llm", factory, undefined, undefined, (p) => stays.push(p));

      emit(frame(20));
      c.abort();
      emit(frame(70));

      expect(gone.map((p) => p.pct)).toEqual([20]); // detached on abort — no writes to a dead stream
      expect(stays.map((p) => p.pct)).toEqual([20, 70]);

      d.resolve(fakeReport("r"));
      await Promise.all([leaving.catch(() => {}), staying]);
    });

    it("a factory that throws SYNCHRONOUSLY evicts the entry (no promise-less run for others to join)", async () => {
      // The entry is registered before the factory runs (so a synchronously-emitted frame has a sink),
      // so a sync throw must not strand a promise-less entry that later callers would "join" and hang on.
      expect(() =>
        coalesceScan("p6::llm", () => {
          throw new Error("boom");
        }),
      ).toThrow("boom");
      expect(inflightScanCount()).toBe(0);

      // The key is reusable immediately — the next caller computes rather than joining a ghost.
      await expect(coalesceScan("p6::llm", async () => fakeReport("r"))).resolves.toEqual(fakeReport("r"));
    });

    it("a caller with no progress sink still works (the JSON route's shape)", async () => {
      const d = deferred<ScanReport>();
      let emit!: (p: ScanProgress) => void;
      const p = coalesceScan("p5::llm", (_s, e) => {
        emit = e;
        return d.promise;
      });
      expect(() => emit(frame(10))).not.toThrow(); // no listeners registered — a no-op fan-out
      d.resolve(fakeReport("r"));
      await expect(p).resolves.toEqual(fakeReport("r"));
    });
  });
});

// Cache-identity invariant (scan-pipeline #5): the whole pipeline (scan routes, public badge, CI gate)
// keys through normalizeRepoName/makeCacheKey, so a single logical repo+commit+mode MUST collapse to
// exactly ONE key regardless of casing / percent-encoding / whitespace — otherwise `Facebook/React`,
// `facebook/react`, and `facebook%2Freact` fragment into separate entries and a README badge can keep
// serving a stale mock level after a real LLM scan already exists.
describe("normalizeRepoName — casing/encoding/whitespace collapse (scan-pipeline #5)", () => {
  it("lowercases so `Owner` and `owner` collapse to one token", () => {
    expect(normalizeRepoName("Facebook")).toBe("facebook");
    expect(normalizeRepoName("FACEBOOK")).toBe(normalizeRepoName("facebook"));
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRepoName("  react  ")).toBe("react");
    expect(normalizeRepoName("\tReact\n")).toBe("react");
  });

  it("decodes percent-encoding so `o%2Fr` and `o/r` don't mis-split", () => {
    expect(normalizeRepoName("facebook%2Freact")).toBe("facebook/react");
    expect(normalizeRepoName("facebook%2Dreact")).toBe("facebook-react");
    // Encoded uppercase still collapses with the decoded+lowercased form.
    expect(normalizeRepoName("Facebook%2FReact")).toBe(normalizeRepoName("facebook/react"));
  });

  it("is idempotent — re-normalizing an already-normalized value is a no-op", () => {
    const once = normalizeRepoName("Facebook%2FReact");
    expect(normalizeRepoName(once)).toBe(once);
  });

  it("falls back to the trimmed raw value on a malformed %xx escape instead of throwing", () => {
    expect(() => normalizeRepoName("%ZZ")).not.toThrow();
    expect(normalizeRepoName("  %ZZ  ")).toBe("%zz"); // raw kept, just trimmed + lowercased
    expect(normalizeRepoName("100%done")).toBe("100%done"); // lone % is not a valid escape
  });
});

describe("makeCacheKey — one logical repo+commit+mode ⇒ one key (scan-pipeline #5)", () => {
  it("produces the identical key for casing/encoding/whitespace variants of the same repo", () => {
    const canonical = makeCacheKey("facebook", "react", true, "abc123");
    expect(makeCacheKey("Facebook", "React", true, "abc123")).toBe(canonical);
    expect(makeCacheKey("FACEBOOK", "REACT", true, "abc123")).toBe(canonical);
    expect(makeCacheKey("  facebook  ", "  react  ", true, "abc123")).toBe(canonical);
    expect(makeCacheKey("facebook%2Dteam", "react", true, "abc123")).toBe(
      makeCacheKey("facebook-team", "react", true, "abc123"),
    );
  });

  it("lowercases the pinned sha and assembles the `owner/repo@sha::mode#fp` shape", () => {
    // repo/sha/mode stay legible; the trailing #<8 hex> is the {provider,model,rubric} fingerprint.
    expect(makeCacheKey("facebook", "react", true, "ABC123")).toMatch(/^facebook\/react@abc123::llm#[0-9a-f]{8}$/);
    expect(makeCacheKey("facebook", "react", true, "abc123")).toBe(
      makeCacheKey("facebook", "react", true, "ABC123"),
    );
  });

  it("falls back to the un-pinned `owner/repo::mode#fp` form when sha is null/omitted", () => {
    const unpinned = makeCacheKey("facebook", "react", true);
    expect(unpinned).toMatch(/^facebook\/react::llm#[0-9a-f]{8}$/); // no @sha segment
    expect(makeCacheKey("facebook", "react", true, null)).toBe(unpinned);
    expect(makeCacheKey("facebook", "react", true, "")).toBe(unpinned); // empty sha → no pin
  });

  it("toggles the mode segment on useLLM (::llm vs ::mock)", () => {
    expect(makeCacheKey("facebook", "react", true, "sha")).toMatch(/^facebook\/react@sha::llm#[0-9a-f]{8}$/);
    expect(makeCacheKey("facebook", "react", false, "sha")).toMatch(/^facebook\/react@sha::mock#[0-9a-f]{8}$/);
  });

  it("keys a different repo/sha/mode to a DIFFERENT key (no collision)", () => {
    const base = makeCacheKey("facebook", "react", true, "sha1");
    expect(makeCacheKey("vercel", "react", true, "sha1")).not.toBe(base); // different owner
    expect(makeCacheKey("facebook", "next", true, "sha1")).not.toBe(base); // different repo
    expect(makeCacheKey("facebook", "react", true, "sha2")).not.toBe(base); // different sha
    expect(makeCacheKey("facebook", "react", false, "sha1")).not.toBe(base); // different mode
  });

  it("is stable under re-normalization — feeding an already-normalized key's parts back yields the same key", () => {
    const key = makeCacheKey("Facebook%2FTeam", "React", true, "ABC");
    // owner already decoded+lowercased to `facebook/team` — re-running must not drift.
    expect(makeCacheKey("facebook/team", "react", true, "abc")).toBe(key);
  });
});

// Cache-key identity folding (scan-pipeline-ingestion #1): a cached score is a function of the
// {provider, model, rubric} that produced it, not just repo+sha+mode. Fold that identity into the key
// so a model swap / LLM_PROVIDER change / rubric bump makes every prior entry a (safe) MISS instead of
// serving the old number as current for up to the TTL / the 7-day persisted age gate.
describe("makeCacheKey — folds the scoring identity (scan-pipeline-ingestion #1)", () => {
  const gem = (model: string, rubric = "r1"): ScoringIdentity => ({ provider: "gemini", model, rubric });

  it("two different MODELS ⇒ different keys for the same repo+sha+mode", () => {
    const a = makeCacheKey("facebook", "react", true, "sha", gem("gemini-3-flash"));
    const b = makeCacheKey("facebook", "react", true, "sha", gem("gemini-3.5-flash"));
    expect(a).not.toBe(b);
    // repo/sha/mode stay legible; only the fingerprint segment moves.
    expect(a).toMatch(/^facebook\/react@sha::llm#[0-9a-f]{8}$/);
    expect(b).toMatch(/^facebook\/react@sha::llm#[0-9a-f]{8}$/);
  });

  it("two different PROVIDERS ⇒ different keys for the same repo+sha+model", () => {
    const g = makeCacheKey("facebook", "react", true, "sha", { provider: "gemini", model: "m", rubric: "r1" });
    const b = makeCacheKey("facebook", "react", true, "sha", { provider: "bedrock", model: "m", rubric: "r1" });
    expect(g).not.toBe(b);
  });

  it("bumping the RUBRIC version ⇒ different key (the fleet-wide invalidation lever)", () => {
    const v1 = makeCacheKey("facebook", "react", true, "sha", gem("m", "r1"));
    const v2 = makeCacheKey("facebook", "react", true, "sha", gem("m", "r2"));
    expect(v1).not.toBe(v2);
  });

  it("the mock/llm distinction still holds, and mock keys DON'T depend on the LLM provider/model", () => {
    const llm = makeCacheKey("facebook", "react", true, "sha");
    const mock = makeCacheKey("facebook", "react", false, "sha");
    expect(llm).not.toBe(mock); // mode segment + fingerprint differ
    expect(mock).toMatch(/^facebook\/react@sha::mock#[0-9a-f]{8}$/);
    // A supplied LLM identity must not change a MOCK key — the mock score never consults the LLM.
    // (activeScoringIdentity(false) is the pinned mock identity regardless of env.)
    expect(activeScoringIdentity(false)).toEqual({
      provider: "mock",
      model: "deterministic-rubric",
      rubric: expect.any(String),
    });
  });

  it("is stable across calls for the same inputs (deterministic fingerprint)", () => {
    const id = gem("gemini-3-flash");
    expect(makeCacheKey("facebook", "react", true, "sha", id)).toBe(
      makeCacheKey("facebook", "react", true, "sha", id),
    );
    // …and via the env-derived path (no explicit identity) too.
    expect(makeCacheKey("facebook", "react", true, "sha")).toBe(makeCacheKey("facebook", "react", true, "sha"));
  });
});
