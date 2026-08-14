"use client";

// Cold-permalink guard for /report/{owner}/{repo}. When no scan is persisted for a repo, a shared or
// "see an example" permalink would otherwise auto-start a multi-minute live scan the instant the page
// mounts (ReportClient → useReportScan) — a visitor who clicked what looked like a finished report
// never asked for that. So gate it: show a calm "not scanned yet" card with an explicit "Scan now"
// that mounts ReportClient (which then runs the live scan with its full progress checklist). The
// scan-form flow is unaffected — it routes through /report?repo=…, an explicit "I asked to scan" action.

// G6-26: the gate is also the highest-intent moment in the funnel, so below the CTA it now carries
// ColdScanTeaser — what a scan PRODUCES (the rubric, the ladder, the honest terms), never a
// fabricated preview of what this repo would score. See that file for the reasoning.

import { Suspense, useState } from "react";
import { ReportClient } from "@/components/report/ReportClient";
import { ColdScanTeaser } from "@/components/report/ColdScanTeaser";
import { EmptyState } from "@/components/EmptyState";

export function ColdScanGate({ repo }: { repo: string }) {
  const [scanning, setScanning] = useState(false);

  // `repo` may carry a pinned commit (`owner/name@sha`) from a cold commit-pinned permalink. Keep the
  // FULL ref for the scan itself (ReportClient → the scan API accept the owner/name@sha grammar, same
  // as FreshnessControl's re-test link), so "Scan now" scores the pinned commit instead of silently
  // scoring HEAD under a @sha URL — but display the plain owner/name and surface the pin explicitly.
  // (repo-report-shell-tabs 07-16 #1)
  const at = repo.indexOf("@");
  const display = at < 0 ? repo : repo.slice(0, at);
  const sha = at < 0 ? null : repo.slice(at + 1) || null;

  if (scanning) {
    // ReportClient uses useSearchParams → needs a Suspense boundary; it mounts immediately and renders
    // its own live-scan Loading view, so a minimal fallback only covers the brief hydration gap.
    return (
      <Suspense
        fallback={<div className="mx-auto w-full max-w-md py-12 text-center text-sm text-slate-500">Loading…</div>}
      >
        <ReportClient repo={repo} />
      </Suspense>
    );
  }

  return (
    <div>
      <EmptyState
        icon="🛰️"
        // The old body claimed the scan "takes about a minute" and stores nothing. Both were untrue:
        // a live scan is dominated by the model call (scanEstimate.ts measures ~90s hosted to ~6 min
        // on claude-cli), and an anonymous public scan IS persisted — that is exactly how this
        // permalink resolves for the next visitor. The honest terms are spelled out in the teaser.
        title={`No report yet for ${display}`}
        body={`This repository hasn't been scanned on Ascent yet. Scanning it runs a live model assessment, so it takes a few minutes. It's free for public repositories and needs no account.${
          sha ? ` This link pins commit ${sha.slice(0, 7)}, so the scan will score that commit.` : ""
        }`}
        actions={[{ label: "← Back home", href: "/" }]}
      >
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="focus-ring rounded-xl bg-accent px-5 py-2.5 text-base font-medium text-on-accent transition hover:bg-accent-soft"
        >
          Scan {display}{sha ? ` @ ${sha.slice(0, 7)}` : ""} now
        </button>
      </EmptyState>
      <div className="mx-auto -mt-12 w-full max-w-3xl pb-16">
        <ColdScanTeaser />
      </div>
    </div>
  );
}
