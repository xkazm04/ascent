// @vitest-environment jsdom
//
// G6-17: the leaderboard — the largest, most interactive fleet table with bulk selection — was the one
// table omitting OrgTable's sr-only `caption` prop, so screen readers heard an unlabeled table. This
// pins that the rendered <table> now has an accessible name via its <caption>.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RepoLeaderboard } from "./RepoLeaderboard";
import type { LeaderRow } from "./useRepoLeaderboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RepoLeaderboard accessible caption", () => {
  it("gives the table an accessible name for screen readers", () => {
    render(
      <RepoLeaderboard
        slug="acme"
        rows={[
          {
            fullName: "acme/web",
            name: "web",
            watched: true,
            scanSchedule: "off",
            lastScanStatus: null,
            lastScanError: null,
            aiConformance: null,
            techStack: null,
            activity: null,
            latest: null,
          },
        ]}
        segments={[]}
        schedulable
      />,
    );
    expect(screen.getByRole("table", { name: "Repository maturity leaderboard with segment selection" })).toBeInTheDocument();
  });
});

function row(fullName: string): LeaderRow {
  return {
    fullName,
    name: fullName.split("/")[1]!,
    watched: true,
    scanSchedule: "off",
    lastScanStatus: null,
    lastScanError: null,
    aiConformance: null,
    techStack: null,
    activity: null,
    latest: null,
  };
}

const segments = [{ id: "s1", name: "Platform" }];

describe("RepoLeaderboard select-all under a filter", () => {
  it("selects the visible repos when the hidden selection is the same size, and keeps those ticks", () => {
    const first = [row("acme/a"), row("acme/b"), row("acme/c")];
    const { rerender } = render(<RepoLeaderboard slug="acme" rows={first} segments={segments} schedulable />);
    for (const name of ["acme/a", "acme/b", "acme/c"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
    }

    rerender(<RepoLeaderboard slug="acme" rows={[row("acme/d"), row("acme/e"), row("acme/f")]} segments={segments} schedulable />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all repositories" }));
    for (const name of ["acme/d", "acme/e", "acme/f"]) {
      expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeChecked();
    }

    rerender(<RepoLeaderboard slug="acme" rows={first} segments={segments} schedulable />);
    for (const name of ["acme/a", "acme/b", "acme/c"]) {
      expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeChecked();
    }
  });

  it("clears only the visible rows when select-all is already checked", () => {
    const all = [row("acme/a"), row("acme/b"), row("acme/c"), row("acme/d")];
    const { rerender } = render(<RepoLeaderboard slug="acme" rows={all} segments={segments} schedulable />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all repositories" }));

    rerender(<RepoLeaderboard slug="acme" rows={[row("acme/a"), row("acme/b")]} segments={segments} schedulable />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all repositories" }));
    expect(screen.getByRole("checkbox", { name: "Select acme/a" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select acme/b" })).not.toBeChecked();

    rerender(<RepoLeaderboard slug="acme" rows={all} segments={segments} schedulable />);
    expect(screen.getByRole("checkbox", { name: "Select acme/c" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select acme/d" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select acme/a" })).not.toBeChecked();
  });
});

function withCommits(fullName: string, commits: number[] | null): LeaderRow {
  const base = row(fullName);
  if (commits == null) return base;
  return { ...base, activity: { commitsWeekly: commits, prsMerged: 0, prsTotal: 0, locChanged: 0 } };
}

describe("RepoLeaderboard activity sort", () => {
  it("keeps an unmeasured repo behind a measured zero when the column is least-first", () => {
    render(
      <RepoLeaderboard
        slug="acme"
        rows={[withCommits("acme/none", null), withCommits("acme/zero", [0]), withCommits("acme/busy", [4])]}
        segments={segments}
        schedulable
      />,
    );
    const header = screen.getByRole("button", { name: /^Commits/ });
    fireEvent.click(header);
    fireEvent.click(header);
    const body = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    const at = (name: string) => body.findIndex((t) => t.includes(name));
    expect(at("acme/zero")).toBeLessThan(at("acme/busy"));
    expect(at("acme/busy")).toBeLessThan(at("acme/none"));
  });
});
