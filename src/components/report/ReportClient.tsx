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
  // "Email me when it's done" opt-in (set by the scan form). The flag rides the URL; a CUSTOM email
  // (used only when the signed-in account has none) is stashed in sessionStorage so PII stays out of
  // a shareable/loggable URL. Read-only feeds the scan request body — no DOM, so no hydration risk.
  const notify = params.get("notify") === "1";
  const notifyEmail =
    typeof window !== "undefined" ? window.sessionStorage.getItem("ascent:notify-email") ?? undefined : undefined;
  const { state, progress, quota, rescan, attempt, retest, dismissRescan } = useReportScan(repo, initialFresh, {
    notify,
    email: notifyEmail,
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
    <ReportErrorBoundary>
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
