// @vitest-environment jsdom
//
// G6-17: the leaderboard — the largest, most interactive fleet table with bulk selection — was the one
// table omitting OrgTable's sr-only `caption` prop, so screen readers heard an unlabeled table. This
// pins that the rendered <table> now has an accessible name via its <caption>.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoLeaderboard } from "./RepoLeaderboard";

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
