// @vitest-environment jsdom
//
// UAT `TOMAS-L1-05` (recurrence 2, downgraded major → polish). On a configured-but-empty database the
// register's counter survived, so the section headed
// "The register" opened by announcing "0 public repos rated" on a page whose whole proposition is
// "now it has an index". A count is a claim; zero is not one worth making.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicScanGallery } from "@/lib/db";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
import { IndexGallery } from "./IndexGallery";

const row = (fullName: string, over: Record<string, unknown> = {}) => ({
  fullName,
  owner: fullName.split("/")[0]!,
  name: fullName.split("/")[1]!,
  level: "L3",
  levelName: "Managed",
  overall: 71,
  adoption: 68,
  rigor: 74,
  dimensions: {},
  posture: "ai-native",
  primaryLanguage: "TypeScript",
  stars: 12,
  scannedAt: "2026-08-30T00:00:00Z",
  href: "/report/acme/web",
  rubricVersion: SCORING_RUBRIC_VERSION,
  currentRubric: true,
  ...over,
});

const gallery = (over: Partial<PublicScanGallery> = {}): PublicScanGallery =>
  ({ recent: [], topAiNative: [], totalRepos: 0, dbMode: "postgres", ...over }) as unknown as PublicScanGallery;

describe("IndexGallery — the register's counter", () => {
  it("says nothing about the corpus size when the corpus is empty", () => {
    render(<IndexGallery gallery={gallery()} />);
    expect(screen.queryByText(/repos? rated/i)).toBeNull();
  });

  // UAT `RC2-N3`: the register declared two behaviours for the empty corpus — a worded empty state
  // here and an absent section upstream — and only the absent one could ever fire, because
  // `loadPublicGalleryCards` returns null at zero cards so this component is never rendered. The
  // absent section is now the only behaviour; this fixture is a state the loader cannot produce.
  it("renders no worded empty state — an empty corpus is an ABSENT section, decided upstream", () => {
    render(<IndexGallery gallery={gallery()} />);
    expect(screen.queryByText(/No public scans yet/i)).toBeNull();
  });

  it("keeps the count — and the provenance stamp beside it — as soon as there is one repo", () => {
    render(<IndexGallery gallery={gallery({ totalRepos: 1, recent: [row("acme/web")] as never })} />);
    expect(screen.getByText(/1 public repo rated/i)).toBeInTheDocument();
    expect(screen.getByText(/Served live from/i)).toBeInTheDocument();
  });

  it("keeps the provenance stamp on an empty corpus — the counter goes, the honesty stays", () => {
    render(<IndexGallery gallery={gallery()} />);
    expect(screen.getByText(/Served live from/i)).toBeInTheDocument();
  });
});

// MC-B42 / UAT `TOMAS-L1-11`. The rubric is a provenance qualifier: `model.ts` states in writing that
// numbers from two rubric versions are not comparable, and a bump invalidates the gallery cache WITHOUT
// re-scanning, so an un-rescanned repo keeps its old score and is ranked here against fresh ones.
// MC-B18 qualified /leaderboard; this is the SECOND public ranking over the same corpus, and it must
// say the same thing in the same words. Qualified, never de-ranked — a stale score is a real rating
// taken on an earlier instrument, unlike a mock score, which is not a rating at all.
describe("IndexGallery — the rubric qualifier", () => {
  const boardOf = (...rows: unknown[]) =>
    gallery({ totalRepos: rows.length, topAiNative: rows as never, recent: rows as never });

  it("says nothing when every row on the board is on the current ruler", () => {
    render(<IndexGallery gallery={boardOf(row("acme/web"), row("acme/api"))} />);
    expect(screen.queryByText(/rubric/i)).toBeNull();
    expect(screen.queryByText(/Mixed rubrics/i)).toBeNull();
  });

  it("chips a row scored under an earlier rubric, and names that rubric", () => {
    render(<IndexGallery gallery={boardOf(row("acme/web", { rubricVersion: "r10", currentRubric: false }))} />);
    expect(screen.getByText("rubric r10")).toBeInTheDocument();
  });

  it("reads an unstamped scan as UNKNOWN, never as current", () => {
    render(<IndexGallery gallery={boardOf(row("acme/web", { rubricVersion: null, currentRubric: false }))} />);
    expect(screen.getByText("rubric unknown")).toBeInTheDocument();
  });

  it("discloses a mixed-ruler board under the register, counting only the rendered rows", () => {
    render(
      <IndexGallery
        gallery={boardOf(
          row("acme/web", { rubricVersion: "r10", currentRubric: false }),
          row("acme/api"),
          row("acme/cli", { rubricVersion: null, currentRubric: false }),
        )}
      />,
    );
    expect(screen.getByText(/Mixed rubrics on this page/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of these 3 rows were scored under an earlier rubric/i)).toBeInTheDocument();
  });

  it("does not de-rank a stale row — it stays on the board in score order", () => {
    render(<IndexGallery gallery={boardOf(row("acme/web", { rubricVersion: "r10", currentRubric: false }))} />);
    expect(screen.getByTitle("acme/web")).toBeInTheDocument();
  });
});
