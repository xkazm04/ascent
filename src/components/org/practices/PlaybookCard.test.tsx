// @vitest-environment jsdom
//
// Pins playbooks #7: a long unbroken playbook title wraps (break-words) within its min-w-0 flex item
// instead of overflowing the card. The title sits inline with the dim badge, so it wraps rather than
// truncating (keeping it fully visible).

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlaybookCard } from "./PlaybookCard";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

afterEach(cleanup);

function playbook(over: Partial<PlaybookRow> = {}): PlaybookRow {
  return {
    id: "p1",
    title: "Adopt CI",
    dimId: "D1",
    summary: "",
    steps: [],
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("PlaybookCard", () => {
  it("#7: wraps a long title within a min-w-0 break-words container", () => {
    const long = "P".repeat(200);
    render(
      <PlaybookCard
        playbook={playbook({ title: long })}
        slug="acme"
        dimLabel="Testing"
        adoption={undefined}
        repoOptions={[]}
        onRemove={() => {}}
      />,
    );
    const container = screen.getByText(long).parentElement!;
    expect(container).toHaveClass("min-w-0");
    expect(container).toHaveClass("break-words");
  });
});

// ── G6-15: a fully-adopted playbook must not become a dead card ───────────────────────────────────
// The picker + "Mark applied"/"Open draft PR" block used to be gated on "repos not yet applied", so
// at 100% adoption every control vanished with no replacement text — and re-opening a PR for an
// adopted repo (first one closed unmerged, or the playbook has a new version) became impossible.

function renderCard(repoOptions: string[], adoption?: PlaybookAdoption) {
  render(
    <PlaybookCard
      playbook={playbook()}
      slug="acme"
      dimLabel="Testing"
      adoption={adoption}
      repoOptions={repoOptions}
      onRemove={() => {}}
    />,
  );
}

const adopted = (repos: string[]): PlaybookAdoption => ({
  repos: repos.length,
  appliedRepos: repos,
  lift: null,
  measured: 0,
});

describe("PlaybookCard — apply controls at 100% adoption (G6-15)", () => {
  it("keeps the picker and 'Open draft PR' available when every repo is already applied", () => {
    renderCard(["acme/web", "acme/api"], adopted(["acme/web", "acme/api"]));
    const picker = screen.getByRole("combobox", { name: "Repo to apply this playbook to" }) as HTMLSelectElement;
    // Every repo is still offered (labelled as adopted), not filtered out into an empty picker.
    expect([...picker.options].map((o) => o.textContent)).toEqual([
      "Pick a repo…",
      "acme/web · adopted",
      "acme/api · adopted",
    ]);
    expect(screen.getByRole("button", { name: /Open draft PR/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark applied" })).toBeInTheDocument();
  });

  it("explains the all-adopted state instead of rendering an empty region", () => {
    renderCard(["acme/web", "acme/api"], adopted(["acme/web", "acme/api"]));
    expect(screen.getByText(/All 2 repos have adopted this playbook/)).toBeInTheDocument();
  });

  it("says nothing about full adoption while repos remain", () => {
    renderCard(["acme/web", "acme/api"], adopted(["acme/web"]));
    expect(screen.queryByText(/have adopted this playbook/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Repo to apply this playbook to" })).toBeInTheDocument();
  });

  it("explains an empty repo scope rather than silently hiding the controls", () => {
    renderCard([]);
    expect(screen.queryByRole("combobox", { name: "Repo to apply this playbook to" })).toBeNull();
    expect(screen.getByText(/No repos in scope/)).toBeInTheDocument();
  });
});
