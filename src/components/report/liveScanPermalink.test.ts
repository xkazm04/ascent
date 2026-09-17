// @vitest-environment jsdom
//
// After persist, the live-scan job URL (`/report?repo=`) is rewritten to the durable permalink.
// These pin the honesty gates: no rewrite when persist missed, when the scan is scoped, or when
// the identity is not a GitHub owner/name the [owner]/[repo] route can host.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReportPermalinkPath,
  liveScanPermalinkPath,
  peekWasDurable,
  persistedFrameOk,
  reportSectionUrl,
  rewriteLiveScanAddressBar,
} from "./liveScanPermalink";

function href(input: Partial<Parameters<typeof liveScanPermalinkPath>[0]> = {}) {
  return liveScanPermalinkPath({
    pathname: "/report",
    search: "repo=acme%2Fweb",
    fullName: "acme/web",
    persisted: true,
    ...input,
  });
}

describe("liveScanPermalinkPath", () => {
  it("rewrites the live-scan job URL to the durable unpinned permalink after persist", () => {
    expect(href()).toBe("/report/acme/web");
  });

  it("keeps a section tab so a mid-read rewrite does not bounce the reader to Scoring", () => {
    expect(href({ search: "repo=acme%2Fweb&tab=dimensions" })).toBe("/report/acme/web?tab=dimensions");
  });

  it("drops live-scan job keys (repo/fresh/notify) that must not ride the permalink", () => {
    expect(href({ search: "repo=acme%2Fweb&fresh=1&notify=1" })).toBe("/report/acme/web");
  });

  it("does not rewrite when persist did not happen — a reload would hit ColdScanGate", () => {
    expect(href({ persisted: false })).toBeNull();
  });

  it("does not rewrite a scoped scan (never persisted, score is not the default-branch reading)", () => {
    expect(href({ scoped: true, search: "repo=acme%2Fweb&ref=feat" })).toBeNull();
  });

  it("is a no-op on the permalink path itself (ColdScanGate → ReportClient)", () => {
    expect(href({ pathname: "/report/acme/web", search: "" })).toBeNull();
  });

  it("refuses a GitLab identity the [owner]/[repo] route cannot host as two segments", () => {
    expect(href({ fullName: "gitlab:group/project" })).toBeNull();
    expect(href({ fullName: "gitlab:group/sub/project" })).toBeNull();
  });
});

describe("peekWasDurable / persistedFrameOk", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("treats a DB peek or a stale/recent salvage as durable", () => {
    expect(peekWasDurable(headers({ "x-ascent-cache": "hit-db" }))).toBe(true);
    expect(peekWasDurable(headers({ "x-ascent-cache": "hit-recent" }))).toBe(true);
    expect(peekWasDurable(headers({ "x-ascent-stale": "true" }))).toBe(true);
  });

  it("does not treat an in-memory cache hit as durable (DB may be off)", () => {
    expect(peekWasDurable(headers({ "x-ascent-cache": "hit" }))).toBe(false);
    expect(peekWasDurable(headers({}))).toBe(false);
  });

  it("reads the SSE persisted frame as a strict ok:true", () => {
    expect(persistedFrameOk({ ok: true })).toBe(true);
    expect(persistedFrameOk({ ok: false })).toBe(false);
    expect(persistedFrameOk(null)).toBe(false);
    expect(persistedFrameOk("yes")).toBe(false);
  });
});

describe("reportSectionUrl", () => {
  it("keeps live-scan query keys while the job URL is still in the bar", () => {
    expect(reportSectionUrl("/report", "repo=acme%2Fweb", "dimensions")).toBe(
      "/report?repo=acme%2Fweb&tab=dimensions",
    );
  });

  it("does not revert a rewritten permalink back to /report?tab=…", () => {
    expect(reportSectionUrl("/report/acme/web", "repo=acme%2Fweb", "dimensions")).toBe(
      "/report/acme/web?tab=dimensions",
    );
  });

  it("scoring stays clean (no ?tab=) on the permalink", () => {
    expect(reportSectionUrl("/report/acme/web", "tab=dimensions", "scoring")).toBe("/report/acme/web");
  });
});

describe("isReportPermalinkPath", () => {
  it("accepts unpinned and commit-pinned permalinks, not the job page", () => {
    expect(isReportPermalinkPath("/report/acme/web")).toBe(true);
    expect(isReportPermalinkPath("/report/acme/web@abc123")).toBe(true);
    expect(isReportPermalinkPath("/report")).toBe(false);
    expect(isReportPermalinkPath("/report/acme/web/extra")).toBe(false);
  });
});

describe("rewriteLiveScanAddressBar", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("replaceState-s the durable path without adding a history entry", () => {
    window.history.replaceState(null, "", "/report?repo=acme%2Fweb");
    const spy = vi.spyOn(window.history, "replaceState");
    expect(
      rewriteLiveScanAddressBar({
        pathname: "/report",
        search: "repo=acme%2Fweb",
        fullName: "acme/web",
        persisted: true,
      }),
    ).toBe("/report/acme/web");
    expect(spy).toHaveBeenCalledWith(null, "", "/report/acme/web");
    spy.mockRestore();
  });

  it("does not touch history when persist is false", () => {
    window.history.replaceState(null, "", "/report?repo=acme%2Fweb");
    const spy = vi.spyOn(window.history, "replaceState");
    expect(
      rewriteLiveScanAddressBar({
        pathname: "/report",
        search: "repo=acme%2Fweb",
        fullName: "acme/web",
        persisted: false,
      }),
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
