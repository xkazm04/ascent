"use client";

// Report "Contributors" section — recent commit authors with AI-attribution share, plus PR signals.
// Extracted from ReportView so the orchestrator stays within the file-size budget. Only earns its
// nav item when the scan actually surfaced contributor or PR data (gated by the caller).
//
// This surface used to hard-cap at the top 8 with NO disclosure — on a busy repo it silently dropped
// everyone else, and the panel was a dead end: no way to see the rest, nowhere to go from a name.
// It now discloses what it's hiding, reveals the rest on request, links each row to its GitHub
// profile, and says out loud what the bar means and what it does NOT mean.

import { useState } from "react";
import type { Contributor, ScanReport } from "@/lib/types";
import { PrSignalsPanel } from "@/components/report/PrSignalsPanel";
import { Surface } from "@/components/ui";

/** How many rows show before the reader asks for the rest. */
const VISIBLE_DEFAULT = 8;

/** The per-scan contributor cap the persistence layer stores (scans-persist: top 50 by commits). A
 *  list sitting exactly at it is very likely truncated UPSTREAM of this component, which we say
 *  rather than implying the repo has exactly 50 people. */
const STORED_CAP = 50;

/** GitHub logins only (1–39 of alnum/hyphen, no leading/trailing or doubled hyphen). Commit authors
 *  fall back to the git author NAME when no login was resolved (see computeContributors), and a
 *  display name is not a profile — linking one would send the reader to a 404. Non-matching rows
 *  simply render as plain text. */
const GITHUB_LOGIN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export function ContributorsPanel({ report }: { report: ScanReport }) {
  const contributors = report.contributors.filter((c) => c.login !== "unknown");
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? contributors : contributors.slice(0, VISIBLE_DEFAULT);
  const hidden = contributors.length - visible.length;
  const atStoredCap = contributors.length >= STORED_CAP;

  return (
    <div className="space-y-8" data-testid="report-tab-contributors">
      {contributors.length > 0 && (
        <Surface radius="2xl" className="p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold text-white">Recent contributors</h2>
            <span className="font-mono text-sm tabular-nums text-slate-500">
              {visible.length}/{contributors.length} shown
            </span>
          </div>
          <p className="mt-1 text-base text-slate-400">
            From sampled commit history. The bar shows the share that&apos;s AI-attributed.
          </p>
          {/* Orientation, in the same voice as the roadmap's "these aren't orders": say what the bar
              is FOR (a conversation about how the work gets done) and hand over a question, never a
              target. A high share is not a win and a low one is not a failing. */}
          <p className="mt-1 text-base text-slate-500">
            Not a leaderboard, and no share is the &ldquo;right&rdquo; one. It&apos;s something to explore: does the spread
            match how your team believes it works?
          </p>

          <div className="mt-3 space-y-2">
            {visible.map((c, i) => (
              <ContributorRow
                key={c.login}
                contributor={c}
                // Only the rows a reveal just added animate in; the first page is already at rest, so
                // expanding doesn't re-animate what the reader was already looking at. (.animate-fade-up
                // is itself disabled under prefers-reduced-motion.)
                entering={showAll && i >= VISIBLE_DEFAULT}
                delayMs={showAll ? Math.min((i - VISIBLE_DEFAULT) * 24, 240) : 0}
              />
            ))}
          </div>

          {contributors.length > VISIBLE_DEFAULT && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              aria-expanded={showAll}
              className="focus-ring mt-3 rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
            >
              {showAll ? `Show top ${VISIBLE_DEFAULT}` : `Show ${hidden} more`}
            </button>
          )}

          {/* Honest about the edge of the data: this list is the sampled commit window, and a stored
              scan keeps only its most active 50 — so "everyone" here is not everyone in the repo. */}
          <p className="mt-3 border-t border-divider pt-3 text-sm text-slate-500">
            Authors of the commits this scan sampled, not the repo&apos;s full contributor list.
            {atStoredCap && ` A saved scan keeps the ${STORED_CAP} most active, so longer tails are cut here.`}
          </p>
        </Surface>
      )}

      {report.prStats && report.prStats.analyzed > 0 && <PrSignalsPanel stats={report.prStats} />}
    </div>
  );
}

function ContributorRow({
  contributor: c,
  entering,
  delayMs,
}: {
  contributor: Contributor;
  entering: boolean;
  delayMs: number;
}) {
  const pctAI = c.commits ? Math.round((c.aiCommits / c.commits) * 100) : 0;
  const linkable = GITHUB_LOGIN.test(c.login);
  return (
    <div
      className={`flex items-center gap-3 text-base${entering ? " animate-fade-up" : ""}`}
      style={entering ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <span className="w-40 shrink-0 truncate" title={c.name && c.name !== c.login ? c.name : undefined}>
        {linkable ? (
          <a
            href={`https://github.com/${c.login}`}
            target="_blank"
            rel="noreferrer"
            className="focus-ring rounded-sm text-slate-200 transition hover:text-accent"
          >
            {c.login}
          </a>
        ) : (
          <span className="text-slate-200">{c.login}</span>
        )}
      </span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={pctAI}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${c.login}: ${pctAI}% AI-attributed commits`}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pctAI}%` }} />
      </div>
      <span className="w-32 shrink-0 text-right font-mono text-sm tabular-nums text-slate-500">
        {c.aiCommits}/{c.commits} AI · {pctAI}%
      </span>
    </div>
  );
}
