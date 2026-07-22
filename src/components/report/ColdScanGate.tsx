"use client";

// Cold-permalink guard for /report/{owner}/{repo}. When no scan is persisted for a repo, a shared or
// "see an example" permalink would otherwise auto-start a multi-minute live scan the instant the page
// mounts (ReportClient → useReportScan) — a visitor who clicked what looked like a finished report
// never asked for that. So gate it: show a calm "not scanned yet" card with an explicit "Scan now"
// that mounts ReportClient (which then runs the live scan with its full progress checklist). The
// scan-form flow is unaffected — it routes through /report?repo=…, an explicit "I asked to scan" action.

import { Suspense, useState } from "react";
import { ReportClient } from "@/components/report/ReportClient";
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
    <EmptyState
      icon="🛰️"
      title={`No report yet for ${display}`}
      body={`This repository hasn't been scanned on Ascent. A fresh scan reads it through the GitHub API (no clone, nothing stored) and takes about a minute.${
        sha ? ` This link pins commit ${sha.slice(0, 7)} — the scan will score that commit.` : ""
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
  );
}
