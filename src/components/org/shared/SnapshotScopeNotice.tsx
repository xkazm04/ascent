// The honest answer to "does the period control govern THIS tab?" — for the tabs where it does not.
//
// The org dashboard's period is cross-tab state: `resolveOrgWindow` layers `?range=` over the
// `ascent_period` cookie, so a window chosen on Overview follows the user onto every other tab. Most
// tabs honour it (Overview, Delivery, Executive, Security, Teams). Adoption and Contributors CANNOT:
// their inputs are latest-scan SNAPSHOTS, not time series.
//
//   - `RepoContributor` (prisma/schema.prisma) stores one cumulative row per (repo, login) — `commits`
//     and `aiCommits` totals over whatever recent-activity window the scan itself captured, plus a
//     single `lastActiveAt`. There is no per-day commit history to re-aggregate, so "commits in the
//     last 30 days" is not answerable from stored data at any cost.
//   - `Scan.prStats` is likewise a pre-computed JSON aggregate read off each repo's LATEST scan
//     (getOrgPrSignals), not a queryable population of dated PRs.
//
// Threading a `window` argument into those queries would therefore be a FAKE fix: the parameter would
// be accepted and ignored, which is strictly worse than today — it would look scoped in the code as
// well as in the UI. So the contract is DISCLOSURE, and this component is the disclosure. It states,
// at the panel and above the numbers, which period is selected and that this tab does not apply it.
//
// It also renders the selected period as a visibly INERT chip (struck through, `aria-disabled`), so
// the range the user picked is acknowledged on screen rather than silently dropped — the failure mode
// this exists to kill is a user reading a scan-time number while believing it is period-scoped.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { RANGE_OPTIONS, type ResolvedWindow } from "@/lib/window";

/** Human label for a resolved window — the same text the period control prints on its buttons. */
export function windowLabel(period: Pick<ResolvedWindow, "key" | "start" | "end">): string {
  if (period.key === "custom") {
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "…");
    return `${day(period.start)} → ${day(period.end)}`;
  }
  return RANGE_OPTIONS.find((o) => o.key === period.key)?.label ?? period.key;
}

/**
 * Server component (no hooks, no handlers). `subject` names what the tab measures, so the sentence
 * reads naturally on each panel ("adoption", "contributor involvement").
 *
 * `scopedHref`/`scopedLabel` point at a tab that DOES honour the period, so the notice ends in a way
 * forward rather than a dead end.
 */
export function SnapshotScopeNotice({
  period,
  subject,
  scopedHref,
  scopedLabel,
}: {
  period: Pick<ResolvedWindow, "key" | "start" | "end">;
  subject: string;
  scopedHref: string;
  scopedLabel: string;
}) {
  const label = windowLabel(period);
  // A plain warn-tinted panel rather than `Surface`: Surface owns its own hairline + fill, and a
  // caller-supplied competing border/background utility resolves by CSS source order, not by the
  // order of classes here. This is the repo's established warn-callout shell (SecurityTab, /usage).
  return (
    <div
      className="rounded-xl border border-warn/30 bg-warn/5 px-5 py-4"
      role="note"
      aria-label={`Selected period ${label} is not applied to this tab`}
      data-testid="snapshot-scope-notice"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Kicker tone="muted">Period · not applied</Kicker>
        {/* The selected range, acknowledged but visibly dead: same chip shape as the period control,
            struck through and aria-disabled so it can never read as an active choice. */}
        <span
          aria-disabled="true"
          className="inline-flex items-center rounded-md border border-divider px-2.5 py-1 font-mono text-sm text-slate-500 line-through decoration-slate-600"
        >
          {label}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">
        These {subject} numbers are a <span className="text-slate-200">scan-time snapshot</span>, not a
        period aggregate. Contributor commit totals and pull-request stats are captured once per scan and
        stored without per-day history, so no time range — including the one selected above — can re-cut
        them. Read every figure below as &ldquo;the fleet as of its most recent scans&rdquo;.{" "}
        <Link href={scopedHref} className="text-slate-300 underline decoration-slate-600 underline-offset-2 transition hover:text-accent">
          {scopedLabel}
        </Link>{" "}
        does honour the selected period.
      </p>
    </div>
  );
}
