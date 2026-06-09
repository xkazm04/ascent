// Unit tests for the in-flight scan coalescer (bug-hunt finding scan-pipeline #1): concurrent scans of
// the same uncached commit must share ONE run, and the refcounted abort must cancel the shared scan
// only when the LAST interested caller disconnects — so one client navigating away can't kill a scan
// the others still want.

import { describe, it, expect, vi } from "vitest";
import { coalesceScan, inflightScanCount } from "./cache";
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
