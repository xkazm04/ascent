import Link from "next/link";
import { Card, Meter, SectionHeader } from "@/components/org/ui";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { PRACTICES } from "@/lib/practices";

// The Overview "Dimension averages" chart, cross-referenced into the Practices tab: each dimension row
// deep-links to that dimension's practice card (`#practice-<id>` — exemplar · gap repos · reusable
// shape · apply), so a weak fleet average is one click from "how to lift it" instead of a dead-end bar.
// The 1:1 dimension→practice map is the same one the Plan tab uses to seed initiatives (PRACTICES).
const PRACTICE_BY_DIM = new Map(PRACTICES.map((p) => [p.dimId as string, p.id]));

export function DimensionAverages({ slug, dims }: { slug: string; dims: { dimId: string; avg: number }[] }) {
  return (
    <Card>
      <SectionHeader size="sm" title="Dimension averages" right={<span className="font-mono text-sm text-slate-500">→ practices</span>} />
      <div className="mt-3 space-y-1.5">
        {dims.map((d) => {
          const short = DIMENSION_SHORT[d.dimId as keyof typeof DIMENSION_SHORT] ?? d.dimId;
          const practiceId = PRACTICE_BY_DIM.get(d.dimId);
          const body = (
            <>
              <span className="w-20 shrink-0 text-slate-400 group-hover:text-accent">{short}</span>
              <Meter className="flex-1" value={d.avg} color={scoreHex(d.avg)} />
              <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.avg) }}>
                {d.avg}
              </span>
            </>
          );
          // Every dimension maps to a practice, but fall back to a non-link row if the catalog ever
          // lacks one — never render a dead/empty href.
          return practiceId ? (
            <Link
              key={d.dimId}
              href={`/org/${slug}/practices#practice-${practiceId}`}
              title={`See the ${short} practice — exemplar, gap repos, and how to lift this dimension`}
              className="focus-ring group -mx-1 flex items-center gap-3 rounded-md px-1 py-0.5 text-sm transition hover:bg-slate-800/40"
            >
              {body}
            </Link>
          ) : (
            <div key={d.dimId} className="-mx-1 flex items-center gap-3 px-1 py-0.5 text-sm">
              {body}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
