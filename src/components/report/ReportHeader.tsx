import type { ScanReport } from "@/lib/types";
import { ARCHETYPE_LABEL } from "@/lib/maturity/model";
import { timeAgo } from "@/lib/ui";
import { Kicker } from "@/components/ui";
import { FreshnessControl } from "@/components/report/FreshnessControl";

/** Report header — repo title, archetype/engine/confidence chips, and the freshness + export row. */
export function ReportHeader({ report, onRetest }: { report: ScanReport; onRetest?: () => void }) {
  const { repo } = report;
  // Keyless deterministic demo (no LLM). Drive every engine-related treatment off this single
  // flag so the demo signal stays consistent everywhere the engine is shown.
  const isMock = report.engine.provider === "mock";

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Kicker tone="muted">Repository report</Kicker>
        <h1 className="mt-2 text-2xl font-bold text-white">
          <a href={repo.url} target="_blank" rel="noreferrer" className="hover:text-accent">
            {repo.owner}/{repo.name}
          </a>
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base text-slate-400">
          {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
          <span>★ {repo.stars.toLocaleString()}</span>
          <span>updated {timeAgo(repo.pushedAt)}</span>
        </div>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <div className="flex flex-wrap items-center gap-2 text-sm sm:justify-end">
          <span className="rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400">
            {ARCHETYPE_LABEL[report.archetype]}
          </span>
          {report.aiUsage.detected && (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-accent">
              AI usage detected
              {report.aiUsage.commitFraction > 0 ? ` · ${Math.round(report.aiUsage.commitFraction * 100)}% commits` : ""}
            </span>
          )}
          {isMock ? (
            <span
              className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-sky-300"
              title="Keyless demo: scores are computed from deterministic signals, not LLM-written analysis"
            >
              Demo · deterministic rubric
            </span>
          ) : (
            <span className="rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400">
              engine: {report.engine.provider} · {report.engine.model}
            </span>
          )}
          <span className="rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400">
            confidence {Math.round(report.confidence * 100)}%
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <FreshnessControl report={report} onRetest={onRetest} />
          <a
            href={`/api/report/pdf?repo=${encodeURIComponent(`${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`)}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-slate-700 px-2.5 py-1 text-sm font-medium text-slate-300 transition hover:border-accent hover:text-white"
            title="Download this report as a PDF"
          >
            <span aria-hidden>↓</span> Export PDF
          </a>
          <a
            href={`/api/report/skill?repo=${encodeURIComponent(`${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`)}`}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-sm font-medium text-accent transition hover:border-accent hover:text-white"
            title="Download a personalized Claude Code onboarding skill (drop it in .claude/skills/ and run it to act on this report)"
          >
            <span aria-hidden>✦</span> Onboarding skill
          </a>
        </div>
      </div>
    </div>
  );
}
