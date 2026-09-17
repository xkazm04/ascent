// @vitest-environment jsdom
//
// After persist, the live-scan job URL (`/report?repo=`) is rewritten to the durable permalink.
// These pin the honesty gates: no rewrite when persist missed, when the scan is scoped (including
// when the job URL carries `ref`/`path` even if the caller omitted the scoped flag), or when the
// identity is not a GitHub owner/name the [owner]/[repo] route can host. A scoped live scan also
// must not copy that unscoped permalink.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReportPermalinkPath,
  liveScanCopyPermalink,
  liveScanPermalinkPath,
  peekWasDurable,
  persistedFrameOk,
  reportSectionUrl,
  rewriteLiveScanAddressBar,
  searchHasLiveScanScope,
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

  it("does not copy an unscoped permalink from a scoped live-scan URL even if the scoped flag is omitted", () => {
    expect(href({ search: "repo=acme%2Fweb&ref=feat" })).toBeNull();
    expect(href({ search: "repo=acme%2Fweb&path=packages%2Fapi" })).toBeNull();
    expect(href({ search: "repo=acme%2Fweb&ref=feat&path=packages%2Fapi" })).toBeNull();
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

describe("searchHasLiveScanScope", () => {
  it("reads ref and path as scope, ignoring other live-scan job keys", () => {
    expect(searchHasLiveScanScope("repo=acme%2Fweb")).toBe(false);
    expect(searchHasLiveScanScope("repo=acme%2Fweb&fresh=1&notify=1")).toBe(false);
    expect(searchHasLiveScanScope("repo=acme%2Fweb&ref=feat")).toBe(true);
    expect(searchHasLiveScanScope("?path=packages/api")).toBe(true);
    expect(searchHasLiveScanScope("ref=")).toBe(false);
  });
});

describe("liveScanCopyPermalink", () => {
  it("hands over the unscoped durable path (and commit pin) for an unscoped reading", () => {
    expect(liveScanCopyPermalink({ fullName: "acme/web", search: "repo=acme%2Fweb", headSha: "abc123" })).toEqual({
      path: "/report/acme/web",
      pinnedPath: "/report/acme/web@abc123",
    });
  });

  it("does not copy the unscoped permalink from a scoped live scan", () => {
    expect(liveScanCopyPermalink({ fullName: "acme/web", search: "repo=acme%2Fweb&ref=feat", headSha: "abc123" })).toBeNull();
    expect(liveScanCopyPermalink({ fullName: "acme/web", search: "repo=acme%2Fweb&path=packages/api" })).toBeNull();
    expect(
      liveScanCopyPermalink({ fullName: "acme/web", search: "repo=acme%2Fweb", scoped: true, headSha: "abc123" }),
    ).toBeNull();
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

  it("does not rewrite a scoped job URL to /report/{owner}/{repo} even if persist claimed ok", () => {
    window.history.replaceState(null, "", "/report?repo=acme%2Fweb&ref=feat");
    const spy = vi.spyOn(window.history, "replaceState");
    expect(
      rewriteLiveScanAddressBar({
        pathname: "/report",
        search: "repo=acme%2Fweb&ref=feat",
        fullName: "acme/web",
        persisted: true,
      }),
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
