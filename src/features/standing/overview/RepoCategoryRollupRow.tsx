// One repo row inside a RepoCategoryRollup group card. Split out of RepoCategoryRollup.tsx per
// docs/ORG-TABS-REFACTOR.md (JSX regions → sibling components) to keep the parent under the 200-LOC
// cap.
import Link from "next/link";
import { fmtDelta, deltaHex } from "@/components/ui/format";
import { scoreHex, LEVEL_CLASSES, reportPermalink, freshness } from "@/lib/ui";
import { StackRoleIcon } from "@/features/standing/overview/orgIcons";
import { rolesOf, isMockEngine, type RepoTrajectory } from "@/features/standing/overview/repoTrajectory";

export function RepoCategoryRollupRow({ r, orgSlug }: { r: RepoTrajectory; orgSlug: string }) {
  const lc = LEVEL_CLASSES[r.level] ?? LEVEL_CLASSES.L1;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={reportPermalink(r.fullName, null, orgSlug)}
          title={`Open ${r.fullName}'s report`}
          className="focus-ring min-w-0 truncate font-mono text-sm text-slate-200 transition hover:text-accent"
        >
          <span className="text-slate-500">{r.owner}/</span>
          {r.name}
        </Link>
        {/* Provenance: a mock-engine score is the deterministic FLOOR, not a real graded scan — flag it. */}
        {isMockEngine(r.engine) && (
          <span
            title="Deterministic mock score: a placeholder floor, not a live graded scan. Re-scan live to replace it."
            className="shrink-0 rounded border border-slate-700 px-1 font-mono text-xs uppercase tracking-wider text-slate-500"
          >
            mock
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1 text-slate-500" aria-hidden>
          {rolesOf(r).slice(0, 3).map((role) => (
            <StackRoleIcon key={role} role={role} size={13} />
          ))}
        </span>
        <span className={`font-mono text-xs ${lc.text}`}>{r.level}</span>
        <span className="font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(r.overall) }}>
          {r.overall}
        </span>
        {r.deltaWindow == null ? (
          <span className="w-12 text-right font-mono text-xs text-slate-600">—</span>
        ) : r.deltaCrossesEngine ? (
          // Muted: this delta spans a mock → live engine change, so it reflects a scoring-engine
          // transition, not a real code-change movement. Don't dress it in the confident up/down tone.
          <span
            className="w-12 text-right font-mono text-xs tabular-nums text-slate-500"
            title="Spans a mock → live engine change: an engine transition, not a real code-change delta"
          >
            {fmtDelta(r.deltaWindow)}
          </span>
        ) : (
          <span className="w-12 text-right font-mono text-xs tabular-nums" style={{ color: deltaHex(r.deltaWindow) }}>
            {fmtDelta(r.deltaWindow)}
          </span>
        )}
        <span className="hidden w-16 text-right font-mono text-xs text-slate-500 sm:inline">{freshness(r.scannedAt)}</span>
      </div>
    </div>
  );
}
