// The honest answer to "does the period control govern THIS tab?" — for the tabs where it does not.
//
// The org dashboard's period is cross-tab state: `resolveOrgWindow` layers `?range=` over the
// `ascent_period` cookie, so a window chosen on Overview follows the user onto every other tab. Some
// tabs honour it fully (Overview, Executive, Security, Teams). Adoption and Contributors CANNOT:
// their inputs are latest-scan SNAPSHOTS, not time series. DELIVERY IS MIXED, and this header used to
// claim otherwise: only its trend (getOrgDeliveryTrend) and the two W3a/W4 panels are windowed —
// its PR signals, branch governance and commit activity are read off each repo's LATEST scan under
// the same period selector (DeliveryTab's own header says so; nothing on screen did). That mixed case
// is what `scope="partial"` + `detail` below exist to state.
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
 * `scopedHref`/`scopedLabel` point at a surface that DOES honour the period, so the notice ends in a
 * way forward rather than a dead end. Omit both on a tab whose period-scoped half is on the same
 * screen (Delivery's trend), where a link away would be the wrong instruction.
 *
 * `scope`:
 *   - "none" (default) — nothing below the notice honours the period; the chip is struck through.
 *   - "partial" — SOME sections on this tab are period-scoped and the ones under this notice are not.
 *     The chip is then live-looking rather than struck (the range genuinely is applied elsewhere on
 *     the tab), and `detail` must name which sections are which. Saying "not applied" on a tab whose
 *     trend IS windowed would be its own false claim.
 */
export function SnapshotScopeNotice({
  period,
  subject,
  scopedHref,
  scopedLabel,
  scope = "none",
  detail,
}: {
  period: Pick<ResolvedWindow, "key" | "start" | "end">;
  subject: string;
  scopedHref?: string;
  scopedLabel?: string;
  scope?: "none" | "partial";
  /** Replaces the generic snapshot sentence — required in practice for `scope="partial"`, which has
   *  to name the period-scoped sections as well as the snapshot ones. */
  detail?: React.ReactNode;
}) {
  const label = windowLabel(period);
  const partial = scope === "partial";
  // A plain warn-tinted panel rather than `Surface`: Surface owns its own hairline + fill, and a
  // caller-supplied competing border/background utility resolves by CSS source order, not by the
  // order of classes here. This is the repo's established warn-callout shell (SecurityTab, /usage).
  return (
    <div
      className="rounded-xl border border-warn/30 bg-warn/5 px-5 py-4"
      role="note"
      aria-label={
        partial
          ? `Selected period ${label} is applied to only part of this tab`
          : `Selected period ${label} is not applied to this tab`
      }
      data-testid="snapshot-scope-notice"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Kicker tone="muted">{partial ? "Period · partly applied" : "Period · not applied"}</Kicker>
        {/* The selected range, acknowledged but visibly dead: same chip shape as the period control,
            struck through and aria-disabled so it can never read as an active choice. */}
        <span
          aria-disabled={partial ? undefined : "true"}
          className={`inline-flex items-center rounded-md border border-divider px-2.5 py-1 type-mono-sm ${
            partial ? "text-slate-300" : "text-slate-500 line-through decoration-slate-600"
          }`}
        >
          {label}
        </span>
      </div>
      <p className="mt-2 max-w-3xl type-body-sm text-slate-400">
        {detail ?? (
          <>
            These {subject} numbers are a <span className="text-slate-200">scan-time snapshot</span>, not a
            period aggregate. Contributor commit totals and pull-request stats are captured once per scan and
            stored without per-day history, so no time range (including the one selected above) can re-cut
            them. Read every figure below as &ldquo;the fleet as of its most recent scans&rdquo;.
          </>
        )}{" "}
        {scopedHref && scopedLabel && (
          <>
            <Link href={scopedHref} className="text-slate-300 underline decoration-slate-600 underline-offset-2 transition hover:text-accent">
              {scopedLabel}
            </Link>{" "}
            does honour the selected period.
          </>
        )}
      </p>
    </div>
  );
}
