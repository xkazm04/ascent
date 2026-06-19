// Unit tests for the in-flight scan coalescer (bug-hunt finding scan-pipeline #1): concurrent scans of
// the same uncached commit must share ONE run, and the refcounted abort must cancel the shared scan
// only when the LAST interested caller disconnects — so one client navigating away can't kill a scan
// the others still want.

import { describe, it, expect, vi } from "vitest";
import { coalesceScan, inflightScanCount, makeCacheKey, normalizeRepoName } from "./cache";
import type { ScanReport } from "@/lib/types";

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

  it("lowercases the pinned sha and assembles the `owner/repo@sha::mode` shape", () => {
    expect(makeCacheKey("facebook", "react", true, "ABC123")).toBe("facebook/react@abc123::llm");
    expect(makeCacheKey("facebook", "react", true, "abc123")).toBe(
      makeCacheKey("facebook", "react", true, "ABC123"),
    );
  });

  it("falls back to the un-pinned `owner/repo::mode` form when sha is null/omitted", () => {
    const unpinned = "facebook/react::llm";
    expect(makeCacheKey("facebook", "react", true)).toBe(unpinned);
    expect(makeCacheKey("facebook", "react", true, null)).toBe(unpinned);
    expect(makeCacheKey("facebook", "react", true, "")).toBe(unpinned); // empty sha → no pin
  });

  it("toggles the mode segment on useLLM (::llm vs ::mock)", () => {
    expect(makeCacheKey("facebook", "react", true, "sha")).toBe("facebook/react@sha::llm");
    expect(makeCacheKey("facebook", "react", false, "sha")).toBe("facebook/react@sha::mock");
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
