"use client";

import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { appConfigureUrl } from "@/lib/ui";
import { BulkActionsBar } from "./InstallationRepos.BulkActionsBar";
import { CreditCostStrip } from "./InstallationRepos.CreditCostStrip";
import { RepoFilterBar } from "./RepoFilterBar";
import { RepoListSkeleton } from "./RepoListSkeleton";
import { RepoRow } from "./RepoRow";
import { useInstallationRepos } from "./useInstallationRepos";

export function InstallationRepos({ org, installationId }: { org: string; installationId?: string }) {
  const {
    view,
    errors,
    watchPending,
    credit,
    segments,
    segMembership,
    query,
    setQuery,
    visibility,
    setVisibility,
    watchedOnly,
    setWatchedOnly,
    language,
    setLanguage,
    bulkBusy,
    bulkMsg,
    toggleSegment,
    toggleWatch,
    changeSchedule,
    watchAllFiltered,
    scheduleWatched,
    languages,
    filtered,
    watchedCount,
    scheduledCount,
    scheduledRuns,
    allowanceRemaining,
    monthlyCredits,
    underAMonth,
  } = useInstallationRepos({ org, installationId });

  if (view.status === "loading") return <RepoListSkeleton />;
  if (view.status === "error")
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-base text-danger-soft">
        {view.message}
      </div>
    );
  if (view.repos.length === 0)
    return (
      <EmptyState
        variant="section"
        body="No repositories accessible to this installation. Adjust access on GitHub, then refresh."
        // Deep-link straight to THIS installation's Configure page — the screen where repos are
        // granted — instead of leaving the user to navigate GitHub settings by hand (the most
        // common selected-repo onboarding dead-end). Hidden when the id isn't known.
        actions={
          installationId
            ? [{ label: "Adjust repository access on GitHub →", href: appConfigureUrl(installationId), primary: true }]
            : []
        }
      />
    );

  return (
    <div className="animate-fade-up">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-base">
        <span className="text-slate-400">
          <span className="font-semibold text-white">{watchedCount}</span> of {view.repos.length} watched
        </span>
        <Link
          href={`/org/${encodeURIComponent(org)}`}
          className="rounded-lg border border-accent/40 px-3 py-1.5 font-mono text-sm uppercase tracking-widest text-accent hover:bg-accent/10"
        >
          Org dashboard →
        </Link>
      </div>

      <CreditCostStrip
        credit={credit}
        scheduledCount={scheduledCount}
        scheduledRuns={scheduledRuns}
        monthlyCredits={monthlyCredits}
        allowanceRemaining={allowanceRemaining}
        underAMonth={underAMonth}
      />

      <BulkActionsBar
        filtered={filtered}
        watchedCount={watchedCount}
        bulkBusy={bulkBusy}
        bulkMsg={bulkMsg}
        onWatchAllFiltered={watchAllFiltered}
        onScheduleWatched={scheduleWatched}
      />

      {/* Search + filters — type to find a repo instead of scrolling hundreds. */}
      <RepoFilterBar
        query={query}
        setQuery={setQuery}
        visibility={visibility}
        setVisibility={setVisibility}
        watchedOnly={watchedOnly}
        setWatchedOnly={setWatchedOnly}
        language={language}
        setLanguage={setLanguage}
        languages={languages}
      />

      {filtered.length === 0 ? (
        <EmptyState variant="section" body="No repositories match your search and filters." />
      ) : (
        <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {filtered.map((r) => (
            <RepoRow
              key={r.fullName}
              r={r}
              rowError={errors[r.fullName]}
              onToggleWatch={toggleWatch}
              onChangeSchedule={changeSchedule}
              bulkBusy={bulkBusy}
              watchPending={Boolean(watchPending[r.fullName])}
              segments={segments}
              segmentIds={segMembership[r.fullName] ?? []}
              onToggleSegment={toggleSegment}
            />
          ))}
        </div>
      )}
    </div>
  );
}
