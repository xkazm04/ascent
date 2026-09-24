// @vitest-environment jsdom
//
// Row 40 (backlog develop-2026-09-17): an opened-but-unmerged playbook PR reads as PROPOSED on the
// card, never adopted. The server already keeps it out of `appliedRepos` (getPlaybookAdoption); these
// pin the card's two halves: the optimistic state after "Open draft PR" (usePlaybookCard) and the
// adoption row's copy (PlaybookAdoptionRow), including that a zero adopted count is not printed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { usePlaybookCard } from "./usePlaybookCard";
import { PlaybookAdoptionRow } from "./PlaybookCardAdoption";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const playbook: PlaybookRow = {
  id: "p1",
  title: "Adopt CI",
  dimId: "D1",
  summary: "",
  steps: [],
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
};

const adoption = (over: Partial<PlaybookAdoption>): PlaybookAdoption => ({
  repos: 0,
  appliedRepos: [],
  lift: null,
  measured: 0,
  ...over,
});

describe("usePlaybookCard: opening a draft PR proposes, it does not adopt", () => {
  it("files the repo under proposed, not applied, after a successful PR open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ url: "https://github.com/acme/web/pull/7", number: 7, reused: false }), { status: 200 })),
    );
    const { result } = renderHook(() => usePlaybookCard({ playbook, adoption: undefined }));
    act(() => result.current.setPick("acme/web"));
    await act(async () => {
      await result.current.openPr();
    });
    expect(result.current.applied).toEqual([]);
    expect(result.current.proposed).toEqual(["acme/web"]);
  });

  it("seeds proposed from the server's open-PR repos", () => {
    const { result } = renderHook(() =>
      usePlaybookCard({ playbook, adoption: adoption({ proposedRepos: ["acme/api"] }) }),
    );
    expect(result.current.proposed).toEqual(["acme/api"]);
    expect(result.current.applied).toEqual([]);
  });
});

describe("PlaybookAdoptionRow: proposed is its own reading", () => {
  it("does not print a zero adopted count beside an open PR", () => {
    render(
      <PlaybookAdoptionRow playbook={playbook} slug="acme" adoption={adoption({ proposedRepos: ["acme/web"] })} applied={[]} proposed={["acme/web"]} />,
    );
    expect(screen.queryByText(/Adopted by/)).toBeNull();
    expect(screen.getByText(/draft PRs? open/)).toHaveTextContent("1 draft PR open");
  });

  it("guard: still counts landed repos", () => {
    render(
      <PlaybookAdoptionRow playbook={playbook} slug="acme" adoption={adoption({ repos: 1, appliedRepos: ["acme/web"] })} applied={["acme/web"]} proposed={[]} />,
    );
    expect(screen.getByText(/Adopted by/)).toHaveTextContent("Adopted by 1 repo");
    expect(screen.queryByText(/draft PRs? open/)).toBeNull();
  });

  it("renders nothing when no repo has adopted or been proposed", () => {
    const { container } = render(
      <PlaybookAdoptionRow playbook={playbook} slug="acme" adoption={undefined} applied={[]} proposed={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
