// Tests for the report-shell HTTP-status / abort / timeout taxonomies (Test Mastery
// repo-report-shell finding #5). These were inline decision branches inside React effects in
// ReportView.tsx (history status) and ReportClient.tsx (the catch block); extracted verbatim into
// `reportTaxonomy.ts` so the user-facing-state mapping can be pinned without a DOM.
//
// INVARIANTS pinned:
//  • Only 503 / 401 suppress the trend panel (the quiet "Baseline established"); every other non-OK
//    status (404/429/500…) is a genuine error, and any OK status renders history.
//  • A timeout abort → "timeout" (the smaller-repo guidance), distinct from a non-timeout abort
//    ("interrupted") and from a non-abort error ("network"); an intentional cancel changes nothing.
//
// This repo has no jsdom — these are pure functions run in Node.

import { describe, it, expect } from "vitest";
import { classifyHistoryResponse, classifyScanAbort } from "./reportTaxonomy";

describe("classifyHistoryResponse — /api/history HTTP status → trend-panel state", () => {
  // status -> disposition table. `ok` is derived as (status>=200 && status<300) to mirror Response.ok,
  // but the function takes both because an OK 304 etc. is decided by the caller, not re-derived here.
  it("200 OK renders history", () => {
    expect(classifyHistoryResponse(200, true)).toBe("ok");
  });

  it("304 (treated as OK by the caller) renders history", () => {
    expect(classifyHistoryResponse(304, true)).toBe("ok");
  });

  it("503 (persistence off) is a legitimate no-trends baseline, NOT an error", () => {
    expect(classifyHistoryResponse(503, false)).toBe("no-trends");
  });

  it("401 (signed-out viewer) is a legitimate no-trends baseline, NOT an error", () => {
    expect(classifyHistoryResponse(401, false)).toBe("no-trends");
  });

  it("404 is a real failure (surfaced), not no-trends", () => {
    expect(classifyHistoryResponse(404, false)).toBe("error");
  });

  it("429 (rate limited) is a real failure", () => {
    expect(classifyHistoryResponse(429, false)).toBe("error");
  });

  it("500 (transient DB token expiry etc.) is a real failure — the regression this branch guards", () => {
    expect(classifyHistoryResponse(500, false)).toBe("error");
  });

  it("ONLY 503 and 401 map to no-trends across the full non-OK range (retriable/terminal split)", () => {
    const noTrends = new Set([401, 503]);
    for (let status = 400; status <= 599; status++) {
      const got = classifyHistoryResponse(status, false);
      expect(got).toBe(noTrends.has(status) ? "no-trends" : "error");
    }
  });

  it("ok flag wins even for a status that would otherwise be no-trends", () => {
    // Defensive: an OK response always renders, regardless of the numeric status the caller passes.
    expect(classifyHistoryResponse(401, true)).toBe("ok");
    expect(classifyHistoryResponse(503, true)).toBe("ok");
  });
});

describe("classifyScanAbort — thrown scan error → message taxonomy", () => {
  it("AbortError + timedOut → timeout (the smaller-repo guidance)", () => {
    expect(classifyScanAbort({ name: "AbortError", timedOut: true })).toBe("timeout");
  });

  it("AbortError + !timedOut → interrupted (e.g. a connection reset), NOT network", () => {
    expect(classifyScanAbort({ name: "AbortError", timedOut: false })).toBe("interrupted");
  });

  it("AbortError with timedOut omitted defaults to interrupted, not timeout", () => {
    expect(classifyScanAbort({ name: "AbortError" })).toBe("interrupted");
  });

  it("a non-abort error (TypeError / generic) → network", () => {
    expect(classifyScanAbort({ name: "TypeError" })).toBe("network");
    expect(classifyScanAbort({ name: "Error", timedOut: false })).toBe("network");
    expect(classifyScanAbort({})).toBe("network");
  });

  it("cancelled (intentional unmount/re-run) → none — no state change — and overrides everything", () => {
    expect(classifyScanAbort({ name: "AbortError", timedOut: true, cancelled: true })).toBe("none");
    expect(classifyScanAbort({ name: "AbortError", timedOut: false, cancelled: true })).toBe("none");
    expect(classifyScanAbort({ name: "TypeError", cancelled: true })).toBe("none");
  });

  it("a timeout is never mislabeled as network even if branches are reordered (taxonomy is exhaustive)", () => {
    // Pin that the three live outcomes are mutually exclusive for the same input shape.
    expect(classifyScanAbort({ name: "AbortError", timedOut: true })).not.toBe("network");
    expect(classifyScanAbort({ name: "AbortError", timedOut: true })).not.toBe("interrupted");
  });
});
