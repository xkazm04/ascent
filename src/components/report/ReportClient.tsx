"use client";

import { useSearchParams } from "next/navigation";
import { ReportView } from "@/components/report/ReportView";
import { ReportErrorBoundary } from "@/components/report/ReportErrorBoundary";
import { Empty, Loading } from "@/components/report/ReportClientStatus";
import { RescanBanner } from "@/components/report/ReportRescanBanner";
import { useReportScan } from "@/components/report/useReportScan";
import { QuotaBanner, QuotaBlocked, QuotaStaleNotice } from "@/components/report/QuotaNotice";
import { SignInNotice } from "@/components/SignInNotice";

export function ReportClient({ repo: repoProp }: { repo?: string } = {}) {
  const params = useSearchParams();
  const repo = repoProp ?? params.get("repo") ?? "";
  // `fresh=1` (from a "Re-test" link) forces a re-score that bypasses the report cache. The
  // ingestion layer still issues conditional requests, so an unchanged repo stays cheap on the wire.
  const initialFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
  // "Email me when it's done" opt-in (set by the scan form; the flag rides the URL). The recipient is
  // resolved SERVER-side from the viewer's verified account email — the old sessionStorage custom
  // address ("ascent:notify-email") was silently dropped by the stream route for authenticated viewers
  // (open-relay hardening), so the form no longer collects it and this no longer forwards it.
  // (ambiguity-ui-scan-2026-07-16 scan-pipeline-ingestion #1)
  const notify = params.get("notify") === "1";
  const { state, progress, quota, rescan, attempt, retest, dismissRescan } = useReportScan(repo, initialFresh, {
    notify,
  });

  const signInNext = `/report?repo=${encodeURIComponent(repo)}`;

  if (!repo) {
    return <Empty title="No repository specified" message="Head back and enter a GitHub repo to scan." />;
  }
  if (state.status === "loading" || state.status === "idle") {
    return <Loading repo={repo} progress={progress} />;
  }
  if (state.status === "error") {
    if (state.authRequired) return <SignInNotice next={signInNext} provider="supabase" />;
    return state.blocked ? (
      <QuotaBlocked message={state.message} scope={state.blocked.scope} signInNext={signInNext} />
    ) : (
      <Empty title="Couldn't scan that repo" message={state.message} repo={repo} connect={state.notFound} />
    );
  }
  return (
    // Keyed on the repo so a render error caught for one repo doesn't stick onto the next: this
    // component instance is reused across a ?repo= change (same /report route), so without this the
    // boundary would keep showing repo A's error card after navigating to repo B until a full reload.
    <ReportErrorBoundary resetKeys={[repo]}>
      {/* In-place re-scan: the report below stays mounted while a "Re-test" runs; this banner shows
          live progress, or an inline retry/dismiss on failure (the prior report is kept either way).
          Keyed by `attempt` so the banner's elapsed clock resets on each re-test. */}
      {(rescan.active || rescan.error) && (
        <RescanBanner
          key={attempt}
          repo={repo}
          progress={progress}
          error={rescan.error}
          onRetry={retest}
          onDismiss={dismissRescan}
        />
      )}
      {state.stale ? (
        <QuotaStaleNotice
          scannedAt={state.report.scannedAt}
          resetAt={state.stale.resetAt}
          scope={state.stale.scope}
          signInNext={signInNext}
        />
      ) : (
        quota && (
          <QuotaBanner remaining={quota.remaining} resetAt={quota.resetAt} scope={quota.scope} signInNext={signInNext} />
        )
      )}
      <ReportView report={state.report} onRetest={retest} rescanning={rescan.active} />
    </ReportErrorBoundary>
  );
}
