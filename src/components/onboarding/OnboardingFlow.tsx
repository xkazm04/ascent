"use client";

import { useRef } from "react";
import { PickStep, type Installation } from "@/components/onboarding/OnboardingPickStep";
import { SelectStep } from "@/components/onboarding/OnboardingSelectStep";
import { ScanStep } from "@/components/onboarding/OnboardingScanStep";
import { Shell } from "@/components/onboarding/OnboardingFlow.Shell";
import { MAX_SELECT, buildChecklistSteps, type OrgCredit } from "@/components/onboarding/OnboardingFlow.model";
import { useOnboardingFlow } from "@/components/onboarding/useOnboardingFlow";

// Re-exported so `OnboardingFlow`'s public API (the OrgCredit type) is unchanged for importers.
export type { OrgCredit };

export function OnboardingFlow({
  hasInstallation = false,
  installations = [],
  suggestedOrgs = [],
  seededOrg,
}: {
  hasInstallation?: boolean;
  installations?: Installation[];
  /** Orgs auto-discovered at login that aren't installed yet — one-click "scan this org" nudges. */
  suggestedOrgs?: string[];
  /** Most-active org whose watchlist was pre-seeded at login; surfaced as a "dashboard ready" CTA. */
  seededOrg?: string;
}) {
  const {
    router,
    phase,
    setPhase,
    org,
    setOrg,
    sourceLabel,
    sourceInstallId,
    repos,
    selected,
    rows,
    error,
    loading,
    announce,
    credit,
    previewScan,
    previewCause,
    invitedCount,
    setInvitedCount,
    creditSkipped,
    flowRef,
    stepAnnounce,
    loadRepos,
    loadInstallationRepos,
    toggle,
    selectTop,
    clearSelection,
    cancelScan,
    resetRun,
    startScan,
  } = useOnboardingFlow();

  const checklistSteps = (): ReturnType<typeof buildChecklistSteps> =>
    buildChecklistSteps({ hasInstallation, selected, phase, sourceInstallId, invitedCount, sourceLabel });

  // Finding #4 (double-submission): `startScan` has no re-entrancy lock, and the "Scan {n} repos"
  // button stays mounted for the ~1 frame between a click and setPhase("scanning"), so a fast
  // double-click fires startScan TWICE — two concurrent POSTs to /api/org/import (two credit-reserve
  // windows on the metered path) and a second AbortController that orphans the first stream (Cancel/
  // unmount can then only abort the latest). A React state flag can't guard this: the second click
  // lands before the re-render. A synchronous ref does. Cleared when the scan flow settles (done, or
  // error → back to select) so "Back"/"Scan another" re-arm it. Guarding the wiring here (not inside
  // startScan) because the flow hook that owns startScan is out of this change's scope.
  const submittingRef = useRef(false);
  const guardedStartScan = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    void Promise.resolve(startScan()).finally(() => {
      submittingRef.current = false;
    });
  };

  // ---- pick phase: choose an installed org (private repos) or enter a handle ----------
  if (phase === "pick") {
    return (
      <Shell flowRef={flowRef} stepAnnounce={stepAnnounce}>
        <PickStep
          seededOrg={seededOrg}
          installations={installations}
          suggestedOrgs={suggestedOrgs}
          org={org}
          setOrg={setOrg}
          loading={loading}
          error={error}
          onLoadInstallation={loadInstallationRepos}
          onSubmit={loadRepos}
          onPickOrg={(name) => loadRepos(undefined, name)}
        />
      </Shell>
    );
  }

  // ---- select phase: choose up to MAX_SELECT repos -------------------------
  if (phase === "select") {
    return (
      <Shell flowRef={flowRef} stepAnnounce={stepAnnounce}>
        <SelectStep
          repos={repos}
          selected={selected}
          loading={loading}
          sourceLabel={sourceLabel}
          sourceInstallId={sourceInstallId}
          credit={credit && credit.org === sourceLabel ? credit : null}
          maxSelect={MAX_SELECT}
          onToggle={toggle}
          onSelectTop={selectTop}
          onClear={clearSelection}
          onScan={guardedStartScan}
          onBack={() => setPhase("pick")}
        />
      </Shell>
    );
  }

  // ---- scanning + done phases ---------------------------------------------
  return (
    <Shell flowRef={flowRef} stepAnnounce={stepAnnounce}>
      <ScanStep
        phase={phase}
        rows={rows}
        error={error}
        announce={announce}
        preview={previewScan}
        previewCause={previewCause}
        creditSkipped={creditSkipped}
        checklistSteps={checklistSteps()}
        inviteOrg={sourceInstallId ? sourceLabel : null}
        onInvited={() => setInvitedCount((c) => c + 1)}
        onCancel={cancelScan}
        onViewDashboard={() => router.push(`/org/${encodeURIComponent(sourceLabel)}`)}
        // resetRun clears the FULL per-run state — including the pre-scan credit snapshot, the
        // creditReady promise, preview flags, invite count, and creditSkipped — so a second run
        // can't quote stale money numbers or arrive with "Invite your team" pre-ticked.
        onScanAnother={resetRun}
      />
    </Shell>
  );
}
