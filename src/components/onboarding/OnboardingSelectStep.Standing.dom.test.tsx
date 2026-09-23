// @vitest-environment jsdom
//
// first-run-onboarding-wizard#B (challenge-2026-09-23): the select step shows each repo's standing
// (scanned / pushed since / never scanned), says how many picks are new vs rescans, nets the repos
// that already autoscan out of the recurring cost, and points at the Repositories tab rather than the
// retired Connect page. The public-handle path (no standing on the wire) renders none of it.

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectStep } from "./OnboardingSelectStep";
import { resetAutoWatchOptIn, setAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";
import { resetPreviewFirst } from "./OnboardingSelectStep.previewFirst";
import type { OrgRepo, RepoStanding } from "./types";

/** A row as the public listing sends it: no `standing` key at all. */
function withoutStanding(r: OrgRepo): OrgRepo {
  const copy = { ...r };
  delete copy.standing;
  return copy;
}

const noop = () => {};
const SCANNED_AT = "2026-09-20T10:00:00.000Z";
const st = (over: Partial<RepoStanding> = {}): RepoStanding => ({
  level: "L3",
  overall: 62,
  watched: false,
  schedule: "off",
  scannedAt: SCANNED_AT,
  preview: false,
  ...over,
});
const repo = (fullName: string, standing: RepoStanding | null, pushedAt: string | null = null): OrgRepo => ({
  fullName,
  private: true,
  language: null,
  stars: 0,
  pushedAt,
  standing,
});

beforeEach(() => {
  resetAutoWatchOptIn();
  resetPreviewFirst();
});
afterEach(() => resetAutoWatchOptIn());

function Harness({ repos, initial, installId = "42" }: { repos: OrgRepo[]; initial: string[]; installId?: string | null }) {
  const [selected, setSelected] = useState(new Set(initial));
  return (
    <SelectStep
      repos={repos}
      selected={selected}
      loading={false}
      sourceLabel="acme"
      sourceInstallId={installId}
      credit={{ balance: 0, unlimited: false, allowanceRemaining: 0 }}
      maxSelect={10}
      onToggle={(name) =>
        setSelected((cur) => {
          const next = new Set(cur);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        })
      }
      onSelectTop={noop}
      onClear={noop}
      onScan={noop}
      onBack={noop}
    />
  );
}

describe("SelectStep standing chips", () => {
  it("renders pushed-since, unchanged-and-free, and not-scanned-yet", () => {
    render(
      <Harness
        initial={[]}
        repos={[
          repo("acme/pushed", st(), "2026-09-21T09:00:00.000Z"),
          repo("acme/same", st(), "2026-09-19T09:00:00.000Z"),
          repo("acme/new", null, "2026-09-21T09:00:00.000Z"),
        ]}
      />,
    );
    expect(screen.getByText("L3 · 62 · pushed since last scan")).toBeInTheDocument();
    expect(screen.getByText("L3 · 62 · unchanged: a rescan returns the same score, free")).toBeInTheDocument();
    expect(screen.getByText("not scanned yet")).toBeInTheDocument();
  });

  it("revision: a preview-scanned row is never shown as unchanged or free", () => {
    render(<Harness initial={[]} repos={[repo("acme/preview", st({ preview: true }), "2026-09-19T09:00:00.000Z")]} />);
    expect(screen.queryByText(/unchanged/)).toBeNull();
    expect(screen.getByText("L3 · 62 · preview estimate: the live scan has not run")).toBeInTheDocument();
  });
});

describe("SelectStep selection mix", () => {
  const repos = [
    repo("acme/n1", null),
    repo("acme/n2", null),
    repo("acme/n3", null),
    repo("acme/s1", st()),
    repo("acme/s2", st()),
    repo("acme/p1", st({ preview: true })),
  ];

  it("says how many picks are new and how many are rescans, and updates on toggle", () => {
    render(<Harness repos={repos} initial={["acme/n1", "acme/n2", "acme/n3", "acme/s1", "acme/s2"]} />);
    expect(screen.getByText("3 new · 2 rescans")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /acme\/s2/ }));
    expect(screen.getByText("3 new · 1 rescan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /acme\/p1/ }));
    expect(screen.getByText("4 new · 1 rescan")).toBeInTheDocument();
  });

  it("guard: the public-handle path (no standing on the wire) shows no chips and no mix", () => {
    const plain = repos.map(withoutStanding);
    render(<Harness repos={plain} initial={["acme/n1", "acme/s1"]} installId={null} />);
    expect(screen.queryByText(/new ·/)).toBeNull();
    expect(screen.queryByText(/not scanned yet|pushed since|unchanged/)).toBeNull();
  });
});

describe("SelectStep recurring cost nets existing schedules", () => {
  it("5 selected, 2 already weekly, opted in, allowance 0 -> 12 credits/month, and says why", () => {
    setAutoWatchOptIn(true);
    const repos = [
      repo("acme/a", null),
      repo("acme/b", null),
      repo("acme/c", null),
      repo("acme/w1", st({ watched: true, schedule: "weekly" })),
      repo("acme/w2", st({ watched: true, schedule: "weekly" })),
    ];
    render(<Harness repos={repos} initial={repos.map((r) => r.fullName)} />);
    expect(screen.getByText(/prepaid credits\/month/)).toHaveTextContent(/≈\s*12\s*prepaid credits\/month/);
    expect(screen.getByText(/2 already autoscan weekly/)).toBeInTheDocument();
  });

  it("the opt-in copy points at the Repositories tab, not the retired Connect page", () => {
    render(<Harness repos={[repo("acme/a", null)]} initial={["acme/a"]} />);
    const optIn = screen.getByRole("checkbox", { name: /Also autoscan/i });
    const label = optIn.closest("label");
    expect(label).toHaveTextContent(/change or turn off anytime on the Repositories tab/);
    expect(label?.textContent).not.toMatch(/on Connect/);
  });
});
