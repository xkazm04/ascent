// #16 → #1 — the missing CALL SITE. `detectControlRegressions` (control-matrix.ts) and the
// `control` alert kind (alerts.ts: buildControlAlertMessage / controlCooldownKey) both shipped in
// earlier waves, and nothing joined them: a repo's own doctor could report `guardrail.never-commit`
// flipping pass → fail and the fleet owner learned about it only by opening the matrix. The detector
// existed, the message existed, the dispatcher existed; the wire did not.
//
// This module is that wire, and only that. It is called from the conformance INGEST path AFTER the
// report is persisted, so the alert describes a fact already in the ledger — a push that named a
// regression the ledger did not record would be unauditable.
//
// Four rules, each carried over from the scan-side control dispatcher because breaking one makes the
// alert worse than no alert:
//
//  1. ONLY `pass`/`warn` → `fail` is a regression. `unchecked` → `fail` is a repo that STARTED
//     looking, and paging on it would fire a wall of alerts the first time an org upgrades its
//     doctor — punishing exactly the teams that improved their CI. `detectControlRegressions` owns
//     that rule; this module does not second-guess it.
//  2. The cooldown key is per (repo, control), so two different controls failing on one repo both
//     get through and neither is starved by a score push that already used the repo's generic slot.
//  3. An `AlertEvent` row is written whether or not a sink existed. The decision to raise is the fact
//     worth keeping; a missing sink is a `suppressedReason`, not a reason to forget.
//  4. NEVER THROWS. A telemetry push must not be able to fail a customer's CI ingest.

import { buildControlAlertMessage, controlCooldownKey, type ControlAlertItem } from "@/lib/alerts";
import { deliverAlert } from "@/lib/alert-door";
import { listConformanceReports } from "@/lib/db/org-conformance";
import { detectControlRegressions } from "@/lib/standard/control-matrix";

/**
 * Dispatch the controls that regressed between this repo's newest conformance report and the one
 * before it. Best-effort; returns whether anything reached a sink.
 *
 * The two reports are read back from the LEDGER rather than taken from the request body: the ingest
 * path de-duplicates a re-run of the same commit (delete-then-create on the unique key), so "the
 * report before this one" is a question only the persisted timeline can answer correctly.
 */
export async function alertConformanceRegressions(
  orgSlug: string,
  repoFullName: string,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  try {
    const reports = await listConformanceReports(orgSlug, repoFullName, 2);
    // Null = no history available (no DB / unknown org). One row = nothing to compare against, and a
    // first report is not evidence a control broke — the same "the window cannot prove a change"
    // honesty `sinceFor` keeps in the matrix.
    if (!reports || reports.length < 2) return false;
    const [next, prev] = reports; // listConformanceReports is newest-first
    if (!next || !prev) return false;

    const regressions = detectControlRegressions(prev, next);
    if (regressions.length === 0) return false;

    const items: ControlAlertItem[] = regressions.map((r) => ({
      repo: repoFullName,
      controlId: r.check,
      // `source: "conformance"` is load-bearing for the reader, not decoration: it says this came
      // from the repo's OWN doctor run rather than from our scan or a webhook probe, which is a
      // different freshness claim and a different chain of custody.
      source: "conformance",
      code: "control-failed",
      from: r.from,
      to: r.to,
      // An actor is NEVER fabricated for a conformance-sourced row — no CI payload carries one.
      actorLogin: null,
    }));

    // Rule 2: claim per (repo, control) so a batch is throttled per-control, not all-or-nothing. The
    // first item per key wins, as the per-item filter did before.
    const byKey = new Map<string, ControlAlertItem>();
    for (const i of items) {
      const key = controlCooldownKey(i.repo, i.controlId);
      if (!byKey.has(key)) byKey.set(key, i);
    }

    // Rule 3: the row is written over EVERY regression, not just the dispatched ones — the history
    // has to say a control failed even in the week the push was throttled. The door writes it, and a
    // sink lookup that FAILS is recorded as `sink-unreadable` instead of being swallowed into null
    // (which the resolver used to read as "use the operator's global sink").
    const head = items[0]!;
    const sent = await deliverAlert({
      org: orgSlug,
      signal: opts.signal,
      kind: "control",
      // Every item here is a `control-failed` by construction (the detector emits nothing else), so
      // the batch is critical. Deriving it rather than hard-coding would imply a variability that
      // does not exist on this path.
      severity: "critical",
      repoFullName,
      title: `${head.controlId} failed on ${repoFullName}${items.length > 1 ? ` (+${items.length - 1} more)` : ""}`,
      claim: { cooldown: items.map((i) => controlCooldownKey(i.repo, i.controlId)) },
      build: (keys) => buildControlAlertMessage({ org: orgSlug, items: keys.map((k) => byKey.get(k)!) }),
    });
    return sent.delivered;
  } catch (err) {
    // Rule 4. A conformance POST is a customer's CI step; a telemetry failure must never redden it.
    console.warn("[conformance] control-regression alert failed", err instanceof Error ? err.message : err);
    return false;
  }
}
