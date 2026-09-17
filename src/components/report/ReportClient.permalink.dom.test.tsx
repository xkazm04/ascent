// @vitest-environment jsdom
//
// After a persisted live scan, ReportClient rewriteState-s `/report?repo=` to the durable
// permalink. Withheld when persist did not happen, so a reload cannot land on ColdScanGate
// under a URL whose generateMetadata would still say "No report yet".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ScanReport } from "@/lib/types";
import type { ReportScan } from "./useReportScan";

const scan = vi.hoisted(() => ({ current: {} as ReportScan }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("repo=acme/web"),
}));
vi.mock("./useReportScan", () => ({
  useReportScan: () => scan.current,
}));
vi.mock("./ReportView", () => ({ ReportView: () => <div data-testid="report">report</div> }));
vi.mock("./ReportErrorBoundary", () => ({
  ReportErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ReportClient } from "./ReportClient";

const doneReport = {
  repo: { owner: "acme", name: "web" },
} as unknown as ScanReport;

function doneScan(persisted: boolean): ReportScan {
  return {
    state: { status: "done", report: doneReport },
    progress: { message: "Done", pct: 100 },
    quota: null,
    rescan: { active: false, error: null, errorClass: {} },
    attempt: 0,
    persisted,
    retest: () => {},
    dismissRescan: () => {},
  };
}

describe("ReportClient — live-scan address bar rewrite", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/report?repo=acme%2Fweb");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("rewrites to /report/{owner}/{repo} after persist", async () => {
    scan.current = doneScan(true);
    const spy = vi.spyOn(window.history, "replaceState");
    render(<ReportClient />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(null, "", "/report/acme/web"));
    spy.mockRestore();
  });

  it("leaves /report?repo= in the bar when persist did not happen", async () => {
    scan.current = doneScan(false);
    const spy = vi.spyOn(window.history, "replaceState");
    render(<ReportClient />);
    await waitFor(() => expect(document.querySelector("[data-testid=report]")).toBeTruthy());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
