// The movers column shared by the Overview prototype variants: the repos that REALLY moved this
// period (pickMovers — single-scan and mock→live transitions never count), largest move first, each
// a link to its report. Real nouns, real numbers: repo name · current score · signed delta. No
// hooks — server-safe, so either variant can place it without dragging a boundary.

import Link from "next/link";
import { InlineEmpty } from "@/components/org/shared/ui";
import { deltaHex, fmtDelta } from "@/components/ui/format";
import { reportPermalink, scoreHex } from "@/lib/ui";
import type { RepoTrajectory } from "./repoTrajectory";
import type { Movers } from "./overviewTakeaway";

export function OverviewMovers({
  movers,
  orgSlug,
  deltaLabel,
  /** "editorial" = sans repo names in a column; "log" = mono, instrument-readout voice. */
  voice = "editorial",
}: {
  movers: Movers;
  orgSlug: string;
  deltaLabel: string;
  voice?: "editorial" | "log";
}) {
  const rows = [...movers.risers, ...movers.fallers];
  if (rows.length === 0) {
    return (
      <InlineEmpty>
        No repo moved {deltaLabel.replace(/^vs /, "since ")} — every score held, or has a single scan so far.
      </InlineEmpty>
    );
  }
  const nameClass = voice === "log" ? "type-mono-sm" : "type-body-sm font-medium";
  return (
    <ol className="mt-2 divide-y divide-divider">
      {rows.map((r) => (
        <MoverRow key={r.fullName} r={r} orgSlug={orgSlug} nameClass={nameClass} />
      ))}
    </ol>
  );
}

function MoverRow({ r, orgSlug, nameClass }: { r: RepoTrajectory; orgSlug: string; nameClass: string }) {
  const delta = r.deltaWindow ?? 0;
  return (
    <li className="grid h-10 grid-cols-[minmax(0,1fr)_3rem_3.5rem] items-center gap-x-3">
      <Link
        href={reportPermalink(r.fullName, null, orgSlug)}
        title={`Open ${r.fullName}'s report`}
        className={`focus-ring min-w-0 truncate rounded text-slate-200 transition hover:text-accent ${nameClass}`}
      >
        {r.name}
      </Link>
      <span className="type-mono-sm text-right tabular-nums" style={{ color: scoreHex(r.overall) }}>
        {r.overall}
      </span>
      <span className="type-mono-sm text-right tabular-nums" style={{ color: deltaHex(delta) }}>
        {fmtDelta(delta)}
      </span>
    </li>
  );
}
