import Link from "next/link";
import type { ScanReport } from "@/lib/types";
import { ARCHETYPE_HINT, ARCHETYPE_LABEL } from "@/lib/maturity/model";
import { timeAgo } from "@/lib/ui";
import { Kicker } from "@/components/ui";
import { FreshnessControl } from "@/components/report/FreshnessControl";
import { DownloadButton } from "@/components/report/DownloadButton";
import { pillClass } from "@/components/report/pill";
import { SkillDownload } from "@/components/report/SkillDownload";
import { FoundationPrButton } from "@/components/report/FoundationPrButton";
import { CopyForLlm } from "@/components/CopyForLlm";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";

// Chip hints: `title=` fires only on pointer hover, so every hinted chip ALSO carries the hint as
// sr-only text — screen-reader users hear the explanation inline, and hover users get the tooltip.
// Hoisted so the title and the sr-only copy can't drift apart (repo-report-shell-tabs #3).
const DEMO_HINT = "Keyless demo: scores are computed from deterministic signals, not LLM-written analysis";
// The AWS guarantees (no training, stays inside the AWS boundary) hold for BOTH Bedrock paths, but
// "in-account" reads as "in YOUR account" — which was a false claim on every scan that ran on
// Ascent's PLATFORM Bedrock account. engine.byom (threaded from scan.ts, persisted per row) is the
// only thing that distinguishes them, so the two hints are split on it. undefined (a row scored
// before the flag existed) is UNKNOWN and must take the platform wording — never claim the
// customer's own account without proof.
const bedrockHint = (model: string, byom?: boolean) =>
  byom
    ? `Inference ran in YOUR org's own AWS account on Bedrock (${model}) — code never leaves your AWS boundary and is never used for training`
    : `Inference ran on AWS Bedrock (${model}) in Ascent's AWS account — code stays within the AWS boundary and is never used for training. Connect your own Bedrock (BYOM) to keep it in your account`;
const CONFIDENCE_HINT =
  "Evidence coverage: the share of the repository's signal-bearing files the scan could actually read — lower means the scores rest on thinner evidence";
// D29: the narrative score is intentionally stochastic (no temp-0 path) — say so where the score is
// read, so run-to-run drift reads as disclosed behavior rather than a bug. The CI gate stays
// deterministic; this chip only renders on LLM-scored briefings.
const AI_ESTIMATE_HINT =
  "The narrative scores are an AI assessment and can vary slightly between runs. The CI Scorecard gate uses the deterministic rubric and is fully reproducible";

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
        <Kicker tone="muted">AI-native readiness briefing</Kicker>
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
            <span className="sr-only"> — {ARCHETYPE_HINT[report.archetype]}</span>
          </span>
          {report.aiUsage.detected && (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-accent">
              AI usage detected
              {report.aiUsage.commitFraction > 0 ? ` · ${Math.round(report.aiUsage.commitFraction * 100)}% commits` : ""}
            </span>
          )}
          {isMock ? (
            <span
              className="cursor-help rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-sky-300"
              title={DEMO_HINT}
            >
              Demo · deterministic rubric
              <span className="sr-only"> — {DEMO_HINT}</span>
            </span>
          ) : report.engine.provider === "bedrock" ? (
            // Surface the enterprise-privacy inference path on screen: scoring ran on AWS Bedrock, so
            // the code stayed within the AWS boundary and was never used for training (see
            // docs/ARCHITECTURE.md). The chip label says WHOSE account only when engine.byom proves it.
            <span
              className="cursor-help rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300"
              title={bedrockHint(report.engine.model, report.engine.byom)}
            >
              inference · AWS Bedrock{report.engine.byom ? " · your account" : ""} · {report.engine.model}
              <span className="sr-only"> — {bedrockHint(report.engine.model, report.engine.byom)}</span>
            </span>
          ) : (
            <span className="rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400">
              engine: {report.engine.provider} · {report.engine.model}
            </span>
          )}
          {!isMock && (
            <span
              className="cursor-help rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400"
              title={AI_ESTIMATE_HINT}
            >
              AI estimate · may vary between runs
              <span className="sr-only"> — {AI_ESTIMATE_HINT}</span>
            </span>
          )}
          {/* The report's own credibility signal must explain itself — it's the number most likely
              to be challenged in a shared report (repo-report-shell-tabs #3). */}
          <span
            className="cursor-help rounded-full border border-divider bg-surface/60 px-3 py-1 text-slate-400"
            title={CONFIDENCE_HINT}
          >
            confidence {Math.round(report.confidence * 100)}%
            <span className="sr-only"> — {CONFIDENCE_HINT}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <FreshnessControl report={report} onRetest={onRetest} rescanning={rescanning} />
          {/* Fetch-and-download buttons (not bare anchors): the PDF render can take up to a minute and
              any error branch returns JSON — a plain <a> gave no pending feedback and navigated the
              user onto a raw JSON page on failure (pdf-llm-export #1). */}
          <DownloadButton
            href={`/api/report/pdf?repo=${encodeURIComponent(`${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`)}`}
            className={pillClass({ focusRing: true, textSm: true })}
            title="Download this report as a PDF"
            // PDF export is a Pro-plan+ entitlement (planAllowsPdfExport); a Free-tier org's click 403s.
            // There's no plan/tier data available at this leaf (the report itself carries no org context),
            // so this can't be hidden ahead of the click — but the 403 must not dead-end on inert error
            // text: route it to /pricing instead (G1-36).
            upgradeHref="/pricing"
          >
            <span aria-hidden>↓</span> Export PDF
          </DownloadButton>
          {/* The same 1200×630 card the permalink already advertises as its social unfurl, as a
              download for a slide or a Slack message (G5-04) — one renderer, so what you paste is
              what the link previews. */}
          <DownloadButton
            href={`/api/report/share-card?repo=${encodeURIComponent(`${repo.owner}/${repo.name}${repo.headSha ? `@${repo.headSha}` : ""}`)}`}
            className={pillClass({ focusRing: true, textSm: true })}
            title="Download a shareable score card (PNG)"
          >
            <span aria-hidden>↓</span> Share card
          </DownloadButton>
          {/* The same briefing `GET /api/report/llm?repo=…` serves — one generator (reportLlmMarkdown),
              so the clipboard payload and the endpoint body are identical by construction (G5-17). */}
          <CopyForLlm
            text={reportLlmMarkdown(report)}
            label="Copy for LLM"
            ariaLabel={`Copy the ${repo.owner}/${repo.name} maturity briefing for an LLM`}
          />
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
