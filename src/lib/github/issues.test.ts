// Idempotency of the issue writer (Direction 7). The blocker docket POSTs one issue per selected
// repo per click; without a memory, re-opening the docket after a refresh re-filed the same blocker
// into the customer's repo. createRepoIssue now carries the same hidden-marker mechanism the sticky
// PR comment uses (checks.ts): search the repo's OPEN issues for the marker first, reuse on a hit.
// These pin BOTH paths and the two ways the search must not lie — a PR is not an issue, and a CLOSED
// issue does not block re-filing a regressed blocker.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/github/app", () => ({ githubAppFetch: vi.fn() }));

import { createRepoIssue, passportBlockerMarker } from "./issues";
import { githubAppFetch } from "@/lib/github/app";

const fetchMock = vi.mocked(githubAppFetch);
const MARKER = passportBlockerMarker("auto.self-verify-gaps");

beforeEach(() => vi.clearAllMocks());

/** Queue responses in call order. */
function respond(...results: unknown[]) {
  for (const r of results) fetchMock.mockResolvedValueOnce(r as never);
}

describe("createRepoIssue — marker idempotency", () => {
  it("reuses the open issue already carrying the marker and writes NOTHING", async () => {
    respond([
      { number: 3, html_url: "https://github.com/acme/app/issues/3", body: "unrelated" },
      { number: 9, html_url: "https://github.com/acme/app/issues/9", body: `text\n\n${MARKER}` },
    ]);

    const out = await createRepoIssue("tok", "acme", "app", { title: "T", body: "B", marker: MARKER });

    expect(out).toEqual({ number: 9, url: "https://github.com/acme/app/issues/9", reused: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, , init] = fetchMock.mock.calls[0]!;
    expect(path).toContain("state=open");
    expect(init).toBeUndefined(); // a GET — no method, no body
  });

  it("creates the issue with the marker embedded when no open issue carries it", async () => {
    respond([], { number: 11, html_url: "https://github.com/acme/app/issues/11" });

    const out = await createRepoIssue("tok", "acme", "app", { title: "T", body: "B", marker: MARKER });

    expect(out).toEqual({ number: 11, url: "https://github.com/acme/app/issues/11", reused: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[1]![2]!.body));
    expect(body.body).toContain("B");
    expect(body.body).toContain(MARKER);
  });

  it("does not mistake a PULL REQUEST carrying the marker for the filed issue", async () => {
    // The issues endpoint returns PRs too, and the passport PR writer quotes findings.
    respond(
      [{ number: 4, html_url: "https://github.com/acme/app/pull/4", body: MARKER, pull_request: { url: "x" } }],
      { number: 12, html_url: "https://github.com/acme/app/issues/12" },
    );

    const out = await createRepoIssue("tok", "acme", "app", { title: "T", body: "B", marker: MARKER });

    expect(out.reused).toBe(false);
    expect(out.number).toBe(12);
  });

  it("files a new issue when the marker is absent (no search, no dedupe)", async () => {
    respond({ number: 1, html_url: "https://github.com/acme/app/issues/1" });

    const out = await createRepoIssue("tok", "acme", "app", { title: "T", body: "B" });

    expect(out).toEqual({ number: 1, url: "https://github.com/acme/app/issues/1", reused: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![2]!.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![2]!.body)).body).toBe("B");
  });

  it("pages forward past a full page before concluding the marker is absent", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, html_url: `u${i}`, body: "no" }));
    respond(full, [{ number: 200, html_url: "https://github.com/acme/app/issues/200", body: MARKER }]);

    const out = await createRepoIssue("tok", "acme", "app", { title: "T", body: "B", marker: MARKER });

    expect(out.reused).toBe(true);
    expect(out.number).toBe(200);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("page=2");
  });
});

describe("passportBlockerMarker", () => {
  it("is an HTML comment, so it is invisible in rendered markdown", () => {
    expect(passportBlockerMarker("prod.zero-observability")).toBe(
      "<!-- ascent:passport-blocker:prod.zero-observability -->",
    );
  });
});
