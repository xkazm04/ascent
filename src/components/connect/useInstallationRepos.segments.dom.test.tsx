// @vitest-environment jsdom
//
// `toggleSegment` documented itself as rolling back "like watch/schedule", but those two paths carry a
// per-row monotonic sequence (watchSeq / scheduleSeq) precisely so a SUPERSEDED response can't touch
// state, and this one had none. A double-click on a segment chip fires tag then untag; if the first
// response lands last and failed, its rollback branch still ran — setting a "Couldn't update segment.
// Not saved." error on a chip whose latest request had actually succeeded. Both responses are 2xx-shaped
// as far as the user is concerned, so the error is the only thing they see, and it is a lie.
//
// The sequencing is what makes the ORDER of arrival irrelevant, so that is what this pins.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useInstallationRepos } from "./useInstallationRepos";

afterEach(() => {
  vi.restoreAllMocks();
});

const REPO = {
  fullName: "acme/alpha",
  owner: "acme",
  name: "alpha",
  private: false,
  url: "https://github.com/acme/alpha",
  language: "TypeScript",
  stars: 0,
  pushedAt: null,
  state: { watched: true, scanSchedule: "off", level: null, overall: null },
};

const SEGMENTS = [{ id: "s1", name: "Core", color: "#3b9eff" }];

/** Fetch stub whose segment-membership POSTs resolve OUT OF ORDER: the first call settles last and
 *  fails, the second settles first and succeeds — the double-click race, made deterministic. */
function stubOutOfOrderSegmentPosts() {
  let post = 0;
  let releaseFirst: (() => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/app/repos")) return { ok: true, json: async () => ({ repos: [REPO] }) };
      if (url.includes("/api/org/credits")) return { ok: false, json: async () => ({}) };
      if (url.includes("membership=1")) {
        return { ok: true, json: async () => ({ segments: SEGMENTS, membership: {} }) };
      }
      if (url.includes("/repos") && init?.method === "POST") {
        post += 1;
        if (post === 1) {
          // The stale one: hold it open until the second has settled, then fail it.
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return { ok: false, json: async () => ({}) };
        }
        // The newest click wins the race back.
        queueMicrotask(() => releaseFirst?.());
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe("useInstallationRepos — a superseded segment response cannot touch the row", () => {
  it("does not surface a 'not saved' error from the stale request when the newest one succeeded", async () => {
    stubOutOfOrderSegmentPosts();
    const { result } = renderHook(() => useInstallationRepos({ org: "acme", installationId: "1" }));
    await waitFor(() => expect(result.current.segments).toHaveLength(1));

    // Click one: TAG. Its POST is held open, so the optimistic state commits and the next click reads
    // the updated membership — exactly what a second physical click does.
    await act(async () => {
      void result.current.toggleSegment(REPO, "s1");
      await Promise.resolve();
    });
    expect(result.current.segMembership["acme/alpha"]).toEqual(["s1"]);

    // Click two: UNTAG. Its POST succeeds and releases the first, which then fails — arriving last.
    await act(async () => {
      void result.current.toggleSegment(REPO, "s1");
      await new Promise((r) => setTimeout(r, 0));
    });

    // The stale failure must not speak for the chip: the newest request saved, so there is no error.
    // (Membership lands on [] either way — the loser's rollback happens to agree with the last click —
    // so the error is the observable difference, and it is the one the user would have believed.)
    await waitFor(() => expect(result.current.errors["acme/alpha"]).toBeUndefined());
    expect(result.current.segMembership["acme/alpha"] ?? []).toEqual([]);
  });
});
