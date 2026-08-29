// #16 — the repo × control matrix, and the regression detector behind the future `control-failed`
// alert. Pure: no db, no IO, no clock beyond what the rows carry.
//
// The shape of the problem this solves: a doctor score wobbles for reasons nobody can act on (a run
// with `--run` has a different denominator than one without), while the fact a CISO actually needs —
// "the pre-push secret scan stopped passing in three repos last week" — was printed to a CI log and
// thrown away. Per-check findings under stable ids make that fact queryable.
//
// Two rules run through everything here:
//  1. An ABSENT finding is `unchecked`, never `pass`. A run that did not judge a clause has not
//     cleared it, and a matrix that renders silence as green is worse than no matrix.
//  2. `since` is null when the window cannot prove a change. The first report in a 20-row window is
//     not evidence that the level began there, so it is rendered "—" rather than guessed.

import { parseCheckId, worstLevel, type CheckLevel } from "./check-ids";

/** One report's worth of findings, as read back from the ledger. Timestamps are STRINGS (wire-safe). */
export interface ConformanceReportRow {
  id: string;
  repoFullName: string;
  headSha: string | null;
  score: number;
  fails: number;
  warns: number;
  unchecked: number;
  scored: number;
  specVersion: string | null;
  runShape: string;
  /** A legacy payload with no `findings[]`: every cell for it reads `unchecked`, never `pass`. */
  summaryOnly: boolean;
  reportedAt: string;
  findings: { check: string; level: CheckLevel; message: string }[];
}

export interface ControlMatrixCheck {
  check: string;
  family: string;
  subject: string | null;
  level: CheckLevel;
  /** When this level began, within the window we can see. Null = unknown, rendered "—", never guessed. */
  since: string | null;
  message: string;
}

export interface ControlMatrixRow {
  repoFullName: string;
  checks: ControlMatrixCheck[];
  reportedAt: string;
  summaryOnly: boolean;
  specVersion: string | null;
}

export interface ControlMatrix {
  rows: ControlMatrixRow[];
  /** Every check id seen across the org, sorted — the matrix's column set. */
  checks: string[];
  /** Fleet counts per check. `repos` is the number that reported the check AT ALL. */
  totals: Record<string, { pass: number; warn: number; fail: number; unchecked: number; repos: number }>;
}

/**
 * Collapse one report's findings to one row per check id, worst level wins. Duplicate ids inside a
 * single run are possible (two capabilities slugging to the same subject, a reporter emitting a
 * clause twice); taking the worst is deterministic and cannot manufacture a pass.
 */
export function collapseFindings(
  findings: { check: string; level: CheckLevel; message?: string }[],
): Map<string, { level: CheckLevel; message: string }> {
  const out = new Map<string, { level: CheckLevel; message: string }>();
  for (const f of findings) {
    const prev = out.get(f.check);
    if (!prev) {
      out.set(f.check, { level: f.level, message: f.message ?? "" });
      continue;
    }
    const level = worstLevel(prev.level, f.level);
    out.set(f.check, { level, message: level === prev.level ? prev.message : (f.message ?? "") });
  }
  return out;
}

/**
 * When did this level begin? Walks a check's history (newest-first) until the level changes and
 * returns the timestamp of the OLDEST report still carrying the current level.
 *
 * Returns null when the window holds no change — the level may well have started before the window,
 * and printing the oldest visible report's date would present the edge of our retention as a fact
 * about the repo.
 */
export function sinceFor(history: { level: CheckLevel; reportedAt: string }[]): string | null {
  const [newest] = history;
  if (!newest) return null;
  let since: string | null = null;
  for (const h of history) {
    if (h.level !== newest.level) return since;
    since = h.reportedAt;
  }
  return null; // the whole window is one level: we cannot say when it started
}

/**
 * Build the matrix from reports across an org, newest-first per repo. Only the latest report per repo
 * defines its current levels; the older ones exist to answer `since`.
 */
export function buildControlMatrix(reports: ConformanceReportRow[]): ControlMatrix {
  const byRepo = new Map<string, ConformanceReportRow[]>();
  for (const r of reports) {
    const list = byRepo.get(r.repoFullName);
    if (list) list.push(r);
    else byRepo.set(r.repoFullName, [r]);
  }

  const rows: ControlMatrixRow[] = [];
  const checks = new Set<string>();
  const totals: ControlMatrix["totals"] = {};

  for (const [repoFullName, history] of byRepo) {
    const ordered = [...history].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    const latest = ordered[0]!;
    // A summary-only report proves nothing per check. Its row is stamped as such and carries no
    // checks at all, so the view says "summary-only (doctor < 0.3.0)" instead of an all-green wall.
    const collapsed: Map<string, { level: CheckLevel; message: string }> = latest.summaryOnly
      ? new Map()
      : collapseFindings(latest.findings);
    const perCheck: ControlMatrixCheck[] = [];
    for (const [check, { level, message }] of collapsed) {
      checks.add(check);
      const parsed = parseCheckId(check);
      const history2 = ordered
        .filter((r) => !r.summaryOnly)
        .map((r) => {
          const f = collapseFindings(r.findings).get(check);
          return f ? { level: f.level, reportedAt: r.reportedAt } : null;
        })
        // A report that did not carry this check breaks the run: we cannot claim continuity across a
        // run that never judged the clause.
        .filter((x): x is { level: CheckLevel; reportedAt: string } => x !== null);
      perCheck.push({
        check,
        family: parsed.family,
        subject: parsed.subject,
        level,
        since: sinceFor(history2),
        message,
      });
      const t = (totals[check] ??= { pass: 0, warn: 0, fail: 0, unchecked: 0, repos: 0 });
      t[level] += 1;
      t.repos += 1;
    }
    perCheck.sort((a, b) => a.check.localeCompare(b.check));
    rows.push({
      repoFullName,
      checks: perCheck,
      reportedAt: latest.reportedAt,
      summaryOnly: latest.summaryOnly,
      specVersion: latest.specVersion,
    });
  }

  rows.sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
  return { rows, checks: [...checks].sort((a, b) => a.localeCompare(b)), totals };
}

/**
 * Controls that REGRESSED between two consecutive reports of one repo — `pass`/`warn` → `fail`, and
 * nothing else.
 *
 * `unchecked → fail` is deliberately NOT a regression: an environment that only just started judging
 * a clause has not broken anything, it has started looking. Alerting on it would punish exactly the
 * repos that improved their CI, and would fire a wall of alerts the first time an org upgrades its
 * doctor. Nothing here writes an alert — this lane ships the detector; the alert kind, its message
 * and its dispatch belong to the governance-ledger lane.
 */
export function detectControlRegressions(
  prev: ConformanceReportRow | null,
  next: ConformanceReportRow,
): { check: string; from: CheckLevel; to: CheckLevel }[] {
  if (!prev || prev.summaryOnly || next.summaryOnly) return [];
  const before = collapseFindings(prev.findings);
  const after = collapseFindings(next.findings);
  const out: { check: string; from: CheckLevel; to: CheckLevel }[] = [];
  for (const [check, now] of after) {
    if (now.level !== "fail") continue;
    const was = before.get(check);
    if (!was) continue; // not judged before: a new check is not a regression
    if (was.level === "pass" || was.level === "warn") out.push({ check, from: was.level, to: "fail" });
  }
  return out.sort((a, b) => a.check.localeCompare(b.check));
}
