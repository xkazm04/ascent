// The Front page punch-list: the owed dimensions (below the green band), weakest first, capped at
// three. Compact rows on a fixed 40px rhythm — name · meter · score · delta · the one-line reading
// · the named practice link — the same facts the full ledger carries, restricted to the rows a
// reader acts on today. The rest of the ledger is one disclosure below. No hooks — server-safe.

import Link from "next/link";
import { InlineEmpty, Meter } from "@/components/org/shared/ui";
import { deltaHex, fmtDelta } from "@/components/ui/format";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import { orgTabHref } from "@/lib/org/orgTabs";
import { scoreHex } from "@/lib/ui";
import type { DimensionReading } from "./dimensionReading";

// name · meter · score · delta · reading · practice — fixed tracks so rows share columns.
const ROW = "grid h-10 grid-cols-[7.5rem_minmax(4rem,1fr)_2.75rem_3.25rem_minmax(0,2fr)_11rem] items-center gap-x-4";

export function OverviewFrontPageFixRows({
  fixes,
  owed,
  total,
  slug,
  className = "",
}: {
  fixes: DimensionReading[];
  owed: number;
  total: number;
  slug: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="type-label tracking-[0.22em] text-slate-500">Fix first</span>
        <span className="type-caption tabular-nums text-slate-500">
          {owed === 0 ? `every dimension ≥ ${FOLLOW_UP_BELOW}` : `${owed} of ${total} dimensions below ${FOLLOW_UP_BELOW}`}
        </span>
      </div>
      {fixes.length === 0 ? (
        <InlineEmpty>Every dimension is in the green band — nothing is owed a follow-up in this view.</InlineEmpty>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <ol className="min-w-[44rem] divide-y divide-divider">
            {fixes.map((r) => (
              <FixRow key={r.dimId} r={r} slug={slug} />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function FixRow({ r, slug }: { r: DimensionReading; slug: string }) {
  const color = scoreHex(r.avg);
  return (
    <li className={ROW}>
      <span className="min-w-0 truncate">
        <span className="type-body-sm font-medium text-slate-100">{r.short}</span>{" "}
        <span className="type-micro uppercase tracking-[0.12em]" style={{ color }}>
          {r.status}
        </span>
      </span>
      <Meter value={r.avg} color={color} size="sm" ariaLabel={`${r.short} average ${r.avg}`} />
      <span className="type-mono-sm text-right font-semibold tabular-nums" style={{ color }}>
        {r.avg}
      </span>
      <span
        className="type-caption text-right tabular-nums"
        style={{ color: r.delta === null || r.delta === 0 ? undefined : deltaHex(r.delta) }}
        title={r.delta === null ? "No baseline in this window" : undefined}
      >
        {r.delta === null ? <span className="text-slate-600">—</span> : r.delta === 0 ? <span className="text-slate-500">→0</span> : fmtDelta(r.delta)}
      </span>
      <span className="type-note min-w-0 truncate text-slate-400" title={r.note}>
        {r.note}
      </span>
      {r.practice ? (
        <Link
          href={`${orgTabHref(slug, "practices")}#practice-${r.practice.id}`}
          className="focus-ring type-caption min-w-0 truncate rounded text-slate-400 transition hover:text-accent"
          title={`Open the practice that lifts ${r.short}: ${r.practice.label}`}
        >
          Practice → <span className="text-slate-200">{r.practice.label.replace(/\s*\(.*\)\s*$/, "")}</span>
        </Link>
      ) : (
        <span className="type-caption text-slate-600">no practice yet</span>
      )}
    </li>
  );
}
