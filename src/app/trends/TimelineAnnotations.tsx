// The annotation legend for the trend timeline (G5-18).
//
// Markers are derived in `annotations.ts` from the scan series itself — band crossings and
// threshold-crossing regressions. Rendering them as a dated strip beside the chart makes a dip
// diagnostic ("dropped to L2 at 4f3a91c") instead of merely descriptive, WITHOUT reaching into the
// chart's internals: `TrendChart` is owned elsewhere, so the in-chart vertical rules are a separate,
// additive step against the `TrendAnnotation` contract this list already consumes.
//
// Server component (no hooks).

import { githubCommitUrl, reportPermalink } from "@/lib/ui";
import type { TrendAnnotation } from "@/app/trends/annotations";

const TONE: Record<TrendAnnotation["kind"], { color: string; glyph: string; word: string }> = {
  promotion: { color: "#34d399", glyph: "▲", word: "Promotion" },
  demotion: { color: "#f87171", glyph: "▼", word: "Demotion" },
  regression: { color: "#fbbf24", glyph: "!", word: "Regression" },
};

export function TimelineAnnotations({
  annotations,
  repoFullName,
}: {
  /** Newest-first, from `deriveTrendAnnotations`. */
  annotations: TrendAnnotation[];
  repoFullName: string;
}) {
  if (annotations.length === 0) return null;

  return (
    <section aria-labelledby="timeline-events-heading" className="mt-4">
      <h3 id="timeline-events-heading" className="font-mono text-sm uppercase tracking-[0.2em] text-slate-500">
        Events on this timeline
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {annotations.map((a) => {
          const tone = TONE[a.kind];
          // Links take the FULL sha (a truncated one resolves to no scan); the short one is display only.
          const href = a.commitSha ? reportPermalink(repoFullName, a.commitSha) : null;
          const commit = githubCommitUrl(repoFullName, a.commitSha);
          return (
            <li key={a.scanId} className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-400">
              <span aria-hidden className="font-mono" style={{ color: tone.color }}>
                {tone.glyph}
              </span>
              <span className="font-mono tabular-nums text-slate-500">{a.at.slice(0, 10)}</span>
              <span className="font-mono" style={{ color: tone.color }}>
                {tone.word} {a.label}
              </span>
              <span className="text-slate-400">{a.detail}</span>
              {href && (
                <a href={href} className="font-mono text-slate-500 underline hover:text-white">
                  report
                </a>
              )}
              {commit && (
                <a href={commit} className="font-mono text-slate-500 underline hover:text-white">
                  commit
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
