"use client";

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
    setSourceInstallId,
    setRepos,
    repos,
    selected,
    setSelected,
    rows,
    setRows,
    error,
    setError,
    loading,
    announce,
    credit,
    previewScan,
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
    startScan,
  } = useOnboardingFlow();

  const checklistSteps = (): ReturnType<typeof buildChecklistSteps> =>
    buildChecklistSteps({ hasInstallation, selected, phase, sourceInstallId, invitedCount, sourceLabel });

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
          onScan={startScan}
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
        creditSkipped={creditSkipped}
        checklistSteps={checklistSteps()}
        inviteOrg={sourceInstallId ? sourceLabel : null}
        onInvited={() => setInvitedCount((c) => c + 1)}
        onCancel={cancelScan}
        onViewDashboard={() => router.push(`/org/${encodeURIComponent(sourceLabel)}`)}
        onScanAnother={() => {
          setPhase("pick");
          setRepos([]);
          setSelected(new Set());
          setRows({});
          setError(null);
          setSourceInstallId(null);
        }}
      />
    </Shell>
  );
}
