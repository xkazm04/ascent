// The last-rounds table's filters and paging — pure. Newest first, eight rows a page, one chip per
// filter with its count so a filter that would empty the table says so before it is pressed.

import type { DeskRound } from "./roundsModel";
import { repoShort } from "./deskFormat";

export const PER_PAGE = 8;

export interface RoundFilter {
  id: string;
  label: string;
  test: (r: DeskRound) => boolean;
}

export function roundFilters(rounds: readonly DeskRound[]): RoundFilter[] {
  const repos = [...new Set(rounds.flatMap((r) => [...r.repos, ...r.lanes.map((l) => l.repo)]))].sort();
  return [
    { id: "all", label: "All", test: () => true },
    { id: "closes", label: "With closes", test: (r) => r.closes > 0 },
    { id: "rejected", label: "Rejected", test: (r) => r.verdicts.rejected > 0 },
    { id: "errored", label: "Errored", test: (r) => r.errors > 0 || r.error != null },
    ...repos.map((repo) => ({
      id: `repo:${repo}`,
      label: repoShort(repo),
      test: (r: DeskRound) => r.repos.includes(repo) || r.lanes.some((l) => l.repo === repo),
    })),
  ];
}

export interface TablePage {
  rows: DeskRound[];
  page: number;
  pages: number;
  total: number;
  /** "1–8 of 62", or "none". */
  range: string;
}

export function tablePage(rounds: readonly DeskRound[], filter: RoundFilter, page: number): TablePage {
  const all = [...rounds].reverse().filter(filter.test);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const p = Math.max(0, Math.min(page, pages - 1));
  const rows = all.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  return {
    rows,
    page: p,
    pages,
    total: all.length,
    range: all.length ? `${p * PER_PAGE + 1}–${Math.min(all.length, p * PER_PAGE + PER_PAGE)} of ${all.length}` : "none",
  };
}
