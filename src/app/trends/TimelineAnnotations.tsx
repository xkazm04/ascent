// The annotation legend for the trend timeline (G5-18).
//
// Markers are derived in `annotations.ts` from the scan series itself (band crossings and
// threshold-crossing regressions) and in `deployAnnotations.ts` from persisted Deployment rows.
// Rendering them as a dated strip beside the chart makes a dip diagnostic ("dropped to L2 at
// 4f3a91c", "1 failed deploy before this scan") instead of merely descriptive; `TrendChart` draws the
// same list in-chart against the same `TrendAnnotation` contract.
//
// Server component (no hooks).

import { githubCommitUrl, reportPermalink } from "@/lib/ui";
import type { TrendAnnotation } from "@/app/trends/annotations";
import { deployColor } from "@/app/trends/deployTone";

const TONE: Record<TrendAnnotation["kind"], { color: string; glyph: string; word: string }> = {
  promotion: { color: "#34d399", glyph: "▲", word: "Promotion" },
  demotion: { color: "#f87171", glyph: "▼", word: "Demotion" },
  regression: { color: "#fbbf24", glyph: "!", word: "Regression" },
  // The colour is per marker (red when a deployment in its window failed); see toneFor.
  deploy: { color: deployColor(undefined), glyph: "◆", word: "Deploy" },
};

function toneFor(a: TrendAnnotation): { color: string; glyph: string; word: string } {
  const tone = TONE[a.kind];
  return a.kind === "deploy" ? { ...tone, color: deployColor(a.deploys) } : tone;
}

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
      <h3 id="timeline-events-heading" className="type-mono-sm uppercase tracking-[0.2em] text-slate-500">
        Events on this timeline
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {annotations.map((a) => {
          const tone = toneFor(a);
          // Links take the FULL sha (a truncated one resolves to no scan); the short one is display only.
          const href = a.commitSha ? reportPermalink(repoFullName, a.commitSha) : null;
          const commit = githubCommitUrl(repoFullName, a.commitSha);
          return (
            // Kind-scoped key: a deploy marker and a score event can pin to the same scan.
            <li key={`${a.kind}:${a.scanId}`}className="flex flex-wrap items-baseline gap-x-2 type-body-sm text-slate-400">
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
