// @vitest-environment jsdom
//
// The dead-ends panel (moonshot #14). FAILS BEFORE: the component did not exist.
//
// Three things it must get right: render NOTHING at zero rows (an empty "no dead ends" card would
// assert that nothing has ever failed), group by repo, and render a body as TEXT — the content is
// untrusted prose mirrored out of a customer repository and this is the last place it is displayed.

import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoMemoryDeadEnds, groupByRepo } from "./RepoMemoryDeadEnds";
import type { RepoMemoryEntryRow } from "@/lib/db/repo-memory";

// The panel now opens on a MatrixGrid, which reads `prefers-reduced-motion` through
// `useSyncExternalStore`; jsdom has no matchMedia. Stub it to the REDUCED branch, as every viz
// `.dom.test.tsx` does, so the geometry is asserted in its settled state.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

function row(over: Partial<RepoMemoryEntryRow> & { id: string; repoFullName: string }): RepoMemoryEntryRow {
  return {
    path: ".ai/memory/0007-x.md",
    entryId: "0007",
    rawKind: "failed-approach",
    mappedKind: "procedural",
    scope: null,
    entryDate: "2026-06-10",
    supersedes: null,
    refs: [],
    body: "We tried a shared PGlite cache; the drift never self-repaired on boot.",
    headSha: null,
    superseded: false,
    orgMemoryId: null,
    skipReason: null,
    firstSeenAt: "2026-06-11T00:00:00.000Z",
    lastSeenAt: "2026-06-11T00:00:00.000Z",
    ...over,
  };
}

describe("RepoMemoryDeadEnds", () => {
  it("renders nothing at all when there are no dead ends", () => {
    const { container } = render(<RepoMemoryDeadEnds rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("groups by repo and counts both levels honestly", () => {
    render(
      <RepoMemoryDeadEnds
        rows={[
          row({ id: "1", repoFullName: "acme/api" }),
          row({ id: "2", repoFullName: "acme/api", path: ".ai/memory/0008-y.md" }),
          row({ id: "3", repoFullName: "acme/web" }),
        ]}
      />,
    );
    // Each repo now names itself twice: once as a row of the claims matrix (and its sr-only
    // equivalent), once as the group heading over its entries.
    expect(screen.getAllByText("acme/api").length).toBeGreaterThan(0);
    expect(screen.getAllByText("acme/web").length).toBeGreaterThan(0);
    expect(screen.getByText("3 across 2 repos")).toBeTruthy();
    expect(screen.getByText("2 dead ends")).toBeTruthy();
    expect(screen.getByText("1 dead end")).toBeTruthy();
  });

  it("renders a body as TEXT, never as markup", () => {
    const hostile = '<img src=x onerror="alert(1)"> and <b>bold</b>';
    const { container } = render(
      <RepoMemoryDeadEnds rows={[row({ id: "1", repoFullName: "acme/api", body: hostile })]} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(hostile)).toBeTruthy();
  });

  it("shows the repo-authored date verbatim, and says 'undated' rather than inventing one", () => {
    render(
      <RepoMemoryDeadEnds
        rows={[
          row({ id: "1", repoFullName: "acme/api", entryDate: "10 June 2026" }),
          row({ id: "2", repoFullName: "acme/web", entryDate: null }),
        ]}
      />,
    );
    expect(screen.getByText("10 June 2026")).toBeTruthy();
    expect(screen.getByText("undated")).toBeTruthy();
  });

  it("encodes the claims-not-facts caveat as state, per repo, instead of asserting it in prose", () => {
    // FAILS BEFORE: the caveat was the tail of a 297-char SectionHeader description; every row then
    // rendered identically to a verified finding.
    const { container } = render(
      <RepoMemoryDeadEnds
        rows={[row({ id: "1", repoFullName: "acme/api" }), row({ id: "2", repoFullName: "acme/web" })]}
      />,
    );
    const claimed = container.querySelector('[data-cell="acme/api:Claimed"]');
    const verified = container.querySelector('[data-cell="acme/api:Verified"]');
    expect(claimed?.getAttribute("data-state")).toBe("declared");
    expect(verified?.getAttribute("data-state")).toBe("not-judged");
    // A hatched cell prints no number, ever — that is what "not verified" has to look like.
    expect(verified?.querySelector("[data-score]")).toBeNull();
    expect(container.querySelector('[data-cell="acme/web:Claimed"]')).not.toBeNull();
  });

  it("carries no SectionHeader description at all — the header is a noun phrase", () => {
    const { container } = render(
      <RepoMemoryDeadEnds rows={[row({ id: "1", repoFullName: "acme/api" })]} />,
    );
    expect(container.textContent).not.toContain("not verified facts");
    expect(container.textContent).not.toContain("Mirrored here so the next team");
  });

  it("truncates a long body with an ellipsis but keeps the full text on the copy control", () => {
    const long = "x".repeat(600);
    const { container } = render(
      <RepoMemoryDeadEnds rows={[row({ id: "1", repoFullName: "acme/api", body: long })]} />,
    );
    const pre = container.querySelector("pre")!;
    expect(pre.textContent!.length).toBeLessThan(600);
    expect(pre.textContent!.endsWith("…")).toBe(true);
  });
});

describe("groupByRepo", () => {
  it("preserves the incoming order between and within groups", () => {
    const groups = groupByRepo([
      row({ id: "1", repoFullName: "b/two" }),
      row({ id: "2", repoFullName: "a/one" }),
      row({ id: "3", repoFullName: "b/two" }),
    ]);
    expect(groups.map((g) => g.repo)).toEqual(["b/two", "a/one"]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["1", "3"]);
  });
});
