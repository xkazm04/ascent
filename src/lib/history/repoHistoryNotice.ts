// The notice a history page shows for each non-ok state of the shared ladder (repoHistoryAccess.ts).
// One copy for both /trends and /report/compare; only the surface noun differs.

import { historyOutsideWindowNote, type HistoryWindow } from "@/lib/history/window";

export type HistoryNoticeState =
  | { kind: "missing-repo" | "invalid-repo" | "no-db" | "db-down" | "empty" }
  | { kind: "outside-window"; window: HistoryWindow };

export interface HistoryNotice {
  title: string;
  body: string;
  /** The repo the notice names (its scan-it link), absent before the repo parsed. */
  repo?: string;
}

const NOUN = {
  trends: {
    missing: "Add ?repo=owner/repo to see its maturity trends.",
    noDbTitle: "Trends need a database",
    noDbBody:
      "Progress tracking is a Phase 2 feature. Set DATABASE_URL (local Postgres or Aurora DSQL) to record scan history.",
    emptyTail: "to start the trend",
  },
  compare: {
    missing: "Add ?repo=owner/repo to compare its scans.",
    noDbTitle: "Comparison needs a database",
    noDbBody:
      "Scan history is a Phase 2 feature: set DATABASE_URL (local Postgres or Aurora DSQL) to record scans and compare them.",
    emptyTail: "to start tracking changes",
  },
} as const;

export function repoHistoryNotice(
  state: HistoryNoticeState,
  surface: "trends" | "compare",
  repo: string | undefined,
): HistoryNotice {
  const n = NOUN[surface];
  switch (state.kind) {
    case "missing-repo":
      return { title: "No repository specified", body: n.missing };
    case "invalid-repo":
      return { title: "Invalid repository", body: "Use the form owner/repo or a GitHub URL." };
    case "no-db":
      return { title: n.noDbTitle, body: n.noDbBody, repo };
    case "db-down":
      return {
        title: "Scan history is unavailable right now",
        body: `We could not read the scan history for ${repo}. Try again in a moment.`,
        repo,
      };
    case "outside-window":
      return {
        title: "Scans fall outside your plan's history window",
        body: historyOutsideWindowNote(state.window, repo ?? ""),
        repo,
      };
    case "empty":
      return {
        title: "No scans recorded yet",
        body: `We haven't stored any scans for ${repo}. Run a scan ${n.emptyTail}.`,
        repo,
      };
  }
}
