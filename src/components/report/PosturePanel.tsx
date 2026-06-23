import type { ScanReport } from "@/lib/types";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { PostureQuadrant } from "@/components/report/Charts";
import { Kicker, Surface } from "@/components/ui";

export function PosturePanel({
  report,
  prev,
}: {
  report: ScanReport;
  prev?: { adoption: number; rigor: number } | null;
}) {
  return (
    <Surface radius="2xl" className="grid items-center gap-6 p-6 sm:grid-cols-2">
      <div className="flex flex-col justify-center">
        <Kicker tone="accent">Posture</Kicker>
        <h2 className="mt-1 text-xl font-bold text-white">{report.posture.label}</h2>
        <p className="mt-1 text-base leading-relaxed text-slate-400">{report.posture.blurb}</p>
        <div className="mt-5 flex flex-col gap-4">
          <AxisBar label="AI Adoption" value={report.adoptionScore} hint="tooling · agentic · commit signals" />
          <AxisBar label="Engineering Rigor" value={report.rigorScore} hint="tests · CI/CD · docs · quality" />
        </div>
      </div>
      <div className="flex items-center justify-center">
        <PostureQuadrant
          adoption={report.adoptionScore}
          rigor={report.rigorScore}
          posture={report.posture}
          prev={prev}
        />
      </div>
    </Surface>
  );
}

function AxisBar({ label, value, hint }: { label: string; value: number; hint: string }) {
  const color = scoreHex(value);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-base font-medium text-white">{label}</span>
        <span className="flex items-center gap-1 font-mono text-base tabular-nums" style={{ color }}>
          <span aria-hidden>{scoreGlyph(value)}</span>
          {value}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <div className="mt-1 font-mono text-sm uppercase tracking-wider text-slate-400">{hint}</div>
    </div>
  );
}
