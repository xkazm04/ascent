// @vitest-environment jsdom
//
// playbooks-0 (challenge-2026-10-22e): the card's lift badge carries its sample as a sentence -
// how many applications were measured, and why each of the others has no number (liftSampleNote).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlaybookAdoptionRow } from "./PlaybookCardAdoption";
import type { PlaybookAdoption, PlaybookRow } from "@/lib/db";

afterEach(cleanup);

const playbook: PlaybookRow = {
  id: "p1",
  title: "Adopt CI",
  dimId: "D5",
  summary: "",
  steps: [],
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
};

const repos = Array.from({ length: 12 }, (_, i) => `acme/r${i}`);

describe("PlaybookAdoptionRow: the lift title is the sample note", () => {
  it("renders exactly the measured share and every unpaired reason", () => {
    const adoption: PlaybookAdoption = {
      repos: 12,
      appliedRepos: repos,
      lift: 9,
      measured: 3,
      unpaired: { noAfter: 5, noBefore: 2, mock: 2, noDimension: 0 },
    };
    render(<PlaybookAdoptionRow playbook={playbook} slug="acme" adoption={adoption} applied={repos} proposed={[]} />);
    const badge = screen.getByText(/avg D5 since/);
    expect(badge).toHaveAttribute(
      "title",
      "measured in 3 of 12 · 5 not re-scanned since · 2 adopted before their first scan · 2 mock scans excluded",
    );
    expect(badge.getAttribute("title")).not.toContain("\u2014");
  });

  it("a fixture without `unpaired` (written before it existed) still renders the measured share", () => {
    const adoption: PlaybookAdoption = { repos: 2, appliedRepos: repos.slice(0, 2), lift: 4, measured: 2 };
    render(<PlaybookAdoptionRow playbook={playbook} slug="acme" adoption={adoption} applied={repos.slice(0, 2)} proposed={[]} />);
    expect(screen.getByText(/avg D5 since/)).toHaveAttribute("title", "measured in 2 of 2");
  });
});
