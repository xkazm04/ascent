// THE PER-REPO SPEND PANEL — "which repositories drove the bill", now in dollars as well as volume.
//
// A SERVER COMPONENT — no `"use client"`, no hooks, no handlers. It renders rows the page already
// resolved (`summary.byRepo`), extracted out of `usageDashboard.tsx` when it grew a cost column (the
// 300-LOC rule in AGENTS.md is a signal to extract, not to keep appending).
//
// Since round 1 every metered call carries the repository it was made for — `Scan` rows always did,
// and `UsageEvent.repoFullName` since the attribution round — but nothing read either of them for
// MONEY: this panel counted scans and tokens, and the only cost attribution on the page was the
// CODEOWNERS team, one level coarser. `getUsageSummary` now merges both sides per repo.
//
// THE HONESTY RULES ARE THE SHOWBACK MATRIX'S, restated because this panel must not soften them:
//   - A null cost is NOT $0.00. It is an em dash with the reason on hover — an unpriceable repo
//     (your own provider account, an unknown model, a provider that reported no tokens) has not been
//     measured at zero, and the difference is the whole point of the column.
//   - A partially priced repo shows its figure with the unpriced call count beside it, so the number
//     reads as the floor it is.
//   - Work with NO repository — a briefing, an org-wide memory pass — is the explicit last row, never
//     a dropped one, exactly as the team-less bucket is in the two panels above.

import { Surface } from "@/components/ui";
// Deep path, not the barrel: the `@/lib/db` re-export is a Director-owned line that lands at merge.
import type { RepoUsage } from "@/lib/db/usage";

/** "$1.23", or the honest absence — the same rule, and the same words, the lane table uses. */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** The cost cell. `null` prints an em dash with the reason, never a zero: nothing in this repo's
 *  calls could be priced, which is not the same fact as "this repo cost nothing". */
function Cost({ row }: { row: RepoUsage }) {
  if (row.estimatedCostUsd == null) {
    return (
      <span
        className="type-mono-sm text-slate-600"
        title="Nothing recorded for this repository could be priced (your own provider account, no rate for the model, or no tokens reported) — not a measured zero."
      >
        —
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums text-slate-200">
      {money(row.estimatedCostUsd)}
      {row.unpricedCalls > 0 && (
        <span
          className="type-micro text-slate-500"
          title="These calls could not be priced (no rate for the model, your own provider account, or no tokens reported), so the figure beside them is a floor."
        >
          {" "}
          · {row.unpricedCalls.toLocaleString()} unpriced
        </span>
      )}
    </span>
  );
}

/** The volume half — the scan lane's own unit. A repo with ledger spend and no billable scan says
 *  so in calls rather than printing "0 scans", which would read as a measured absence of work. */
function Volume({ row }: { row: RepoUsage }) {
  if (row.scans === 0) {
    return (
      <>
        {row.calls.toLocaleString()} call{row.calls === 1 ? "" : "s"}
        <span title="No billable scan in this window — this repository's spend is in the other lanes (the companion, a memory pass, the local agent).">
          {" "}
          · no billable scan
        </span>
      </>
    );
  }
  return (
    <>
      {row.scans.toLocaleString()} scan{row.scans === 1 ? "" : "s"}
      {row.tokens > 0 ? ` · ${row.tokens.toLocaleString()} tok` : ""}
    </>
  );
}

export function TopReposPanel({ byRepo, periodDays }: { byRepo: RepoUsage[]; periodDays: number }) {
  if (byRepo.length === 0) return null;
  return (
    <Surface className="mt-6 p-6">
      <h2 className="type-body font-semibold text-white">
        Top repositories{" "}
        <span className="font-normal text-slate-500">· by metered scans · last {periodDays}d (UTC)</span>
      </h2>
      <div className="mt-3 space-y-2 type-body">
        {byRepo.map((r) => (
          <div key={r.fullName ?? "org-wide"} className="flex items-baseline justify-between gap-3">
            <span
              className={`min-w-0 truncate type-mono-sm ${r.fullName ? "text-slate-300" : "text-slate-500"}`}
              title={r.fullName ? undefined : "Metered work with no owning repository — counted, never dropped."}
            >
              {r.label}
            </span>
            <span className="shrink-0 text-right">
              <span className="block">
                <Cost row={r} />
              </span>
              <span className="block type-micro text-slate-500">
                <Volume row={r} />
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 type-body-sm text-slate-500">
        Cost is every metered call attributed to the repository — its scans plus the companion, memory
        and agent calls made for it — over the same UTC window as the panels above. An em dash is a
        repository nothing could price, not a measured zero; scans your own provider account served
        (BYOM) are counted in the volume and never priced.
      </p>
    </Surface>
  );
}
