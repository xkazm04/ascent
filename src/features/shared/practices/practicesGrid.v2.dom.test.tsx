// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuidanceCoherenceV2 } from "./foundation/GuidanceCoherence.v2";
import { FoundationRowV2 } from "./foundation/FoundationRow.v2";
import { PracticeRowV2 } from "./PracticeRow.v2";
import type { RepoCoherenceRow } from "./foundation/guidanceCoherenceModel";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import type { RolloutEntry } from "./practiceRolloutGroups";
import type { PracticeRow } from "./practiceRows";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const practice = (over: Partial<PracticeRow> = {}): PracticeRow => ({
  key: "mined:p",
  source: "mined",
  id: "p",
  label: "Test discipline",
  dimId: "D2",
  what: "The guardrail.",
  adoptionPct: 50,
  adoptionLabel: "1/2",
  reachLabel: "1 could adopt",
  opportunity: 1,
  ...over,
});

const entry = (cells: RolloutEntry["cells"]): RolloutEntry => ({ row: practice(), cells });

const coherence = (name: string, score: number | null): RepoCoherenceRow => ({
  fullName: name,
  name: name.split("/")[1] ?? name,
  assessed: score != null,
  coherence: score,
  documents: 1,
  canonical: null,
  canonicalBasis: null,
  projections: [],
  contradictions: [],
  penalties: [],
  verdict: score == null ? "Not assessed by this scan, re-scan." : "Consistent.",
});

const foundation = (over: Partial<FoundationRolloutRow> = {}): FoundationRolloutRow => ({
  repo: "acme/app",
  foundationPrAt: null,
  reportBackAt: null,
  conformance: null,
  conformanceAt: null,
  ...over,
});

describe("Prism stages, spread, and foundation cells", () => {
  it("opens a practice from the row and marks each stage with a word, never a zero for unknown", () => {
    const onOpen = vi.fn();
    render(
      <PracticeRowV2
        onOpen={onOpen}
        entry={entry([
          { state: "measured", score: 40 },
          { state: "declared", score: 12 },
          { state: "missing" },
          { state: "not-judged" },
        ])}
      />,
    );
    expect(document.getElementById("practice-p")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Test discipline/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-role='stage-grid']")?.textContent).toContain("40");
    expect(screen.getByText("declared")).toBeTruthy();
    expect(screen.getByText("missing")).toBeTruthy();
    expect(screen.getByText("not measured")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("draws the coherence spread as a ladder and refuses a one-repo spread", () => {
    const { rerender } = render(<GuidanceCoherenceV2 rows={[coherence("o/a", 40), coherence("o/b", 90)]} />);
    const ladder = screen.getByRole("list", { name: "Coherence spread" });
    expect(ladder.textContent).toContain("Minimum");
    expect(ladder.textContent).toContain("40");
    expect(ladder.querySelector('[data-state="reached"]')).not.toBeNull();
    rerender(<GuidanceCoherenceV2 rows={[coherence("o/a", 40)]} />);
    expect(screen.getByText("One assessed repository. A spread needs at least two.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Coherence spread" })).toBeNull();
  });

  it("renders foundation absence as not measured and a real zero percent as reported", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <FoundationRowV2 row={foundation()} busy={false} onProvision={() => {}} onRevoke={() => {}} />
        </tbody>
      </table>,
    );
    expect(screen.getByText("No Ascent PR")).toBeTruthy();
    expect(screen.getByText("Not provisioned")).toBeTruthy();
    expect(screen.getByText("not measured")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    rerender(
      <table>
        <tbody>
          <FoundationRowV2
            row={foundation({ foundationPrAt: "2026-08-01T00:00:00.000Z", reportBackAt: "2026-08-02T00:00:00.000Z", conformance: 0 })}
            busy={false}
            onProvision={() => {}}
            onRevoke={() => {}}
          />
        </tbody>
      </table>,
    );
    expect(screen.getByText("PR opened")).toBeTruthy();
    expect(screen.getByText("reported")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
  });
});
