import Link from "next/link";
import type { ScanReport } from "@/lib/types";
import { ARCHETYPE_HINT, ARCHETYPE_LABEL } from "@/lib/maturity/model";
import { timeAgo } from "@/lib/ui";
import { Kicker } from "@/components/ui";
import { FreshnessControl } from "@/components/report/FreshnessControl";
import { pillClass } from "@/components/report/pill";
import { SkillDownload } from "@/components/report/SkillDownload";
import { FoundationPrButton } from "@/components/report/FoundationPrButton";

/** Report header — repo title, archetype/engine/confidence chips, and the freshness + export row.
 *  `isMock` (keyless deterministic demo, no LLM) is derived once by ReportView and threaded down so
 *  the demo signal stays consistent everywhere the engine is shown. */
export function ReportHeader({
  report,
  isMock,
  onRetest,
  rescanning,
  installFoundation,
}: {
  report: ScanReport;
  isMock: boolean;
  onRetest?: () => void;
  /** A re-test is in flight — forwarded to the freshness control so it shows "Re-scanning…". */
  rescanning?: boolean;
  /** Viewer is an org member of a non-public repo (server-resolved on the permalink path) — shows the
   *  one-click ".ai/ foundation" install-PR button beside the skill download. The route re-checks
   *  access; this only spares everyone else a button that would 403. */
  installFoundation?: boolean;
}) {
  const { repo } = report;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      {/* min-w-0 lets this column shrink on a narrow viewport; break-words then lets a long unbroken
          owner/name break instead of forcing horizontal overflow of the header (mobile). */}
      <div className="min-w-0">
        <Kicker tone="muted">Repository report</Kicker>
        <h1 className="mt-2 break-words text-2xl font-bold text-white">
          <a href={repo.url} target="_blank" rel="noreferrer" className="hover:text-accent">
            {repo.owner}/{repo.name}
          </a>
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-base text-slate-400">
          {repo.primaryLanguage && <span>{repo.primaryLanguage}</span>}
          <span>★ {repo.stars.toLocaleString()}</span>
          <span>updated {timeAgo(repo.pushedAt)}</span>
        </div>
        {/* Orientation for a first-time reader of a novel maturity framework — the levels, dimensions,
            and archetype lens are explained on the methodology page. */}
        <Link
          href="/about"
          className="focus-ring mt-2 inline-flex items-center gap-1 rounded-sm font-mono text-sm uppercase tracking-widest text-slate-500 transition hover:text-accent"
        >
          How scoring works <span aria-hidden>→</span>
        </Link>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <div className="flex flex-wrap items-center gap-2 text-sm sm:justify-end">
          <span
            className="cursor-help rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400"
            title={ARCHETYPE_HINT[report.archetype]}
          >
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
          ) : report.engine.provider === "bedrock" ? (
            // Surface the enterprise-privacy inference path on screen: when scoring ran on AWS Bedrock,
            // the customer's code stayed in-account and was never used for training (see docs/ARCHITECTURE.md).
            <span
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300"
              title={`Inference ran in-account on AWS Bedrock (${report.engine.model}) — code never leaves the AWS boundary and is never used for training`}
            >
              inference · AWS Bedrock · {report.engine.model}
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
          <FreshnessControl report={report} onRetest={onRetest} rescanning={rescanning} />
          <a
            href={`/api/report/pdf?repo=${encodeURIComponent(`${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`)}`}
            className={pillClass({ focusRing: true, textSm: true })}
            title="Download this report as a PDF"
          >
            <span aria-hidden>↓</span> Export PDF
          </a>
          {/* The pill keeps its one-click default download; the co-located picker beside it exposes the
              generator's maintainer multiselect (?dims=) so a session can be scoped to chosen dimensions. */}
          <SkillDownload
            repoParam={`${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`}
            dimensions={report.dimensions}
          />
          {/* Same customer-repo write surface as the passport PR — one click seeds the generated .ai/
              tree as a draft PR instead of asking the adopting agent to transcribe SKILL.md's blocks. */}
          {installFoundation && <FoundationPrButton repo={`${repo.owner}/${repo.name}`} />}
        </div>
      </div>
    </div>
  );
}
