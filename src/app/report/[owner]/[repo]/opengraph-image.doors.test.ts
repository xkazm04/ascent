// The report permalink's social card: a failed read draws the static fallback AND reaches a door.
//
// opengraph-image.tsx resolves the readable org and the pinned/latest report best-effort; ANY failure
// must still produce an image (an unfurl can never fail), so it degrades to ReportShareCardFallback,
// which names the repo and claims nothing about it. What was a silent catch is now
// `reportDegradedRead("report share card: getScanReportByCommit", err)` — console.warn plus
// reportHandledError telemetry. Pinned for both reads inside the try (the org resolve and the report
// read), against two controls that must NOT reach the door: a real report draws ReportShareCard, and a
// repo that was simply never scanned (null, no error) draws the fallback quietly.
//
// next/og's ImageResponse is replaced by a recorder of its first constructor argument, so the test
// reads WHICH card element the route built without rasterising anything.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  getScanReportByCommit: vi.fn(),
  readableOrgForOwner: vi.fn(),
  rendered: [] as unknown[],
}));

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: unknown) {
      h.rendered.push(element);
    }
  },
}));
vi.mock("@/lib/db", () => ({ getScanReportByCommit: h.getScanReportByCommit }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: h.readableOrgForOwner }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import Image from "./opengraph-image";
import { ReportShareCard, ReportShareCardFallback } from "@/lib/og/report-card";
import { reportHandledError } from "@/lib/api/respond";

type CardElement = ReactElement<Record<string, unknown>>;

/** Run the route for owner/repo and return the single card element handed to ImageResponse. */
async function card(owner: string, repo: string): Promise<CardElement> {
  await Image({ params: Promise.resolve({ owner, repo }) });
  expect(h.rendered).toHaveLength(1);
  return h.rendered[0] as CardElement;
}

const DOOR = "report share card: getScanReportByCommit";
const doorWarned = (spy: MockInstance) => spy.mock.calls.some((c) => String(c[0]).includes(DOOR));

let warn: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  h.rendered.length = 0;
  h.readableOrgForOwner.mockResolvedValue("public");
  h.getScanReportByCommit.mockResolvedValue(null);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("report opengraph image — a failed read degrades to the fallback card and reaches a door", () => {
  it("getScanReportByCommit rejecting draws ReportShareCardFallback naming the repo", async () => {
    h.getScanReportByCommit.mockRejectedValue(new Error("db unreachable"));
    const el = await card("acme", "web");
    expect(el.type).toBe(ReportShareCardFallback);
    expect(el.props.repoRef).toBe("acme/web");
  });

  it("…and the failure is reported: console.warn names the read, telemetry is called", async () => {
    const boom = new Error("db unreachable");
    h.getScanReportByCommit.mockRejectedValue(boom);
    await card("acme", "web");
    expect(doorWarned(warn)).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ message: expect.stringContaining(DOOR) }),
    );
  });

  it("readableOrgForOwner rejecting takes the same path: fallback card + door, report never read", async () => {
    const boom = new Error("auth lookup failed");
    h.readableOrgForOwner.mockRejectedValue(boom);
    const el = await card("acme", "web@abc1234");
    expect(el.type).toBe(ReportShareCardFallback);
    expect(el.props.repoRef).toBe("acme/web");
    expect(h.getScanReportByCommit).not.toHaveBeenCalled();
    expect(doorWarned(warn)).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.stringContaining(DOOR) }));
  });

  it("control: a persisted report draws ReportShareCard with the pinned sha, and reaches no door", async () => {
    const report = { repo: { owner: "acme", name: "web", headSha: "abc1234" }, overallScore: 70 };
    h.readableOrgForOwner.mockResolvedValue("acme");
    h.getScanReportByCommit.mockResolvedValue(report);
    const el = await card("acme", "web@abc1234");
    expect(el.type).toBe(ReportShareCard);
    expect(el.props.report).toBe(report);
    expect(el.props.sha).toBe("abc1234");
    expect(h.getScanReportByCommit).toHaveBeenCalledWith("acme", "web", { headSha: "abc1234", orgSlug: "acme" });
    expect(reportHandledError).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("control: a never-scanned repo (null, no error) draws the fallback WITHOUT reaching the door", async () => {
    const el = await card("acme", "web");
    expect(el.type).toBe(ReportShareCardFallback);
    expect(reportHandledError).not.toHaveBeenCalled();
    expect(doorWarned(warn)).toBe(false);
  });
});
