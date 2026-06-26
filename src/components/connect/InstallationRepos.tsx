"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { CREDIT_ESTIMATE_NOTE, estimateMonthlyCredits, scheduledRunsPerMonth } from "@/lib/credit-estimate";
import { appConfigureUrl } from "@/lib/ui";
import { RepoFilterBar } from "./RepoFilterBar";
import { RepoListSkeleton } from "./RepoListSkeleton";
import { RepoRow } from "./RepoRow";
import { SCHEDULES, type AppRepo, type RepoState, type Visibility } from "./installationRepoTypes";
import { applyWatchOptimistic, filterRepos, patchRepoState, rollbackWatch, summarizeBulkWatch } from "./watchState";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; repos: AppRepo[] };

interface CreditInfo {
  balance: number;
  unlimited: boolean;
  /** Included free monthly scans still available — the estimate nets these out before charging credits. */
  allowanceRemaining: number;
}

export function InstallationRepos({ org, installationId }: { org: string; installationId?: string }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Rows with a watch mutation currently in flight. The schedule control is gated on this so a user
  // can't set a cadence on a repo that is only OPTIMISTICALLY watched — if the watch POST then fails
  // and rolls back, an independent schedule write would otherwise leave an orphaned cadence on an
  // unwatched repo (cron won't scan it, yet the row renders a stale "daily").
  const [watchPending, setWatchPending] = useState<Record<string, boolean>>({});
  // Prepaid-credit context for the commitment moment: every scheduled autoscan on this org draws
  // one credit per run, so the header shows what the current watch/schedule choices cost against
  // the balance. Best-effort — a failed read (DB-less deploy, no access) just hides the strip.
  const [credit, setCredit] = useState<CreditInfo | null>(null);
  // Org segments + per-repo membership, so a repo can be tagged into a slice as it's selected
  // (instead of a second pass on the Repositories tab). Tagging requires the repo to exist as a
  // row, so the picker only shows on watched repos. Best-effort: a failed read just hides the picker.
  const [segments, setSegments] = useState<{ id: string; name: string; color: string }[]>([]);
  const [segMembership, setSegMembership] = useState<Record<string, string[]>>({});

  // Search / filter state (Phase 7 — large orgs have hundreds of repos).
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [language, setLanguage] = useState("all");

  // Bulk watch / bulk schedule across the filtered set (Phase 9 — a 200-repo org shouldn't be 200 clicks).
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);

  useEffect(() => {
    // One <InstallationRepos> renders per installation and `org` can change as the user
    // navigates; without cancellation a slower earlier response can resolve last and render
    // the wrong installation's repos under this heading. Abort the in-flight request on
    // change/unmount and ignore any late resolution, so only the latest request can setView.
    const controller = new AbortController();
    let active = true;
    // Intentional: reset to the loading state whenever `org`/`installationId` changes so the
    // heading doesn't show a stale installation's repos while the new fetch is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ status: "loading" });
    const qs = new URLSearchParams({ org });
    if (installationId) qs.set("installation_id", installationId);
    fetch(`/api/app/repos?${qs.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!active) return;
        if (!r.ok) setView({ status: "error", message: data?.error ?? `Failed (${r.status}).` });
        else setView({ status: "done", repos: (data.repos ?? []) as AppRepo[] });
      })
      .catch(() => {
        if (active) setView({ status: "error", message: "Network error." });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [org, installationId]);

  useEffect(() => {
    // Same cancellation contract as the repo fetch: only the latest org's credit state may land.
    const controller = new AbortController();
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset so a stale org's balance never shows
    setCredit(null);
    fetch(`/api/org/credits?org=${encodeURIComponent(org)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.balance === "number") {
          setCredit({
            balance: d.balance,
            unlimited: Boolean(d.unlimited),
            allowanceRemaining: typeof d.allowanceRemaining === "number" ? d.allowanceRemaining : 0,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [org]);

  useEffect(() => {
    // Load this org's segments + membership (best-effort, cancellable — same contract as above).
    const controller = new AbortController();
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset so a stale org's segments never show
    setSegments([]);
    setSegMembership({});
    fetch(`/api/org/segments?org=${encodeURIComponent(org)}&membership=1`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        setSegments(Array.isArray(d.segments) ? d.segments : []);
        setSegMembership(d.membership ?? {});
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, [org]);

  // Optimistic tag/untag of a repo into a segment (only offered on watched repos — tagging needs the
  // repo row). Rolls back + surfaces an inline error if the POST fails, like watch/schedule.
  async function toggleSegment(r: AppRepo, segId: string) {
    const current = segMembership[r.fullName] ?? [];
    const member = !current.includes(segId);
    setSegMembership((m) => {
      const ids = new Set(m[r.fullName] ?? []);
      if (member) ids.add(segId);
      else ids.delete(segId);
      return { ...m, [r.fullName]: [...ids] };
    });
    setRowError(r.fullName, null);
    try {
      const res = await fetch(`/api/org/segments/${segId}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, fullName: r.fullName, member }),
      });
      if (!res.ok) {
        setSegMembership((m) => {
          const ids = new Set(m[r.fullName] ?? []);
          if (member) ids.delete(segId);
          else ids.add(segId);
          return { ...m, [r.fullName]: [...ids] };
        });
        setRowError(r.fullName, "Couldn't update segment — not saved. Try again.");
      }
    } catch {
      setSegMembership((m) => {
        const ids = new Set(m[r.fullName] ?? []);
        if (member) ids.delete(segId);
        else ids.add(segId);
        return { ...m, [r.fullName]: [...ids] };
      });
      setRowError(r.fullName, "Network error — segment not saved. Try again.");
    }
  }

  function patch(fullName: string, next: Partial<RepoState>) {
    setView((v) =>
      v.status === "done"
        ? { status: "done", repos: patchRepoState(v.repos, fullName, next) }
        : v,
    );
  }

  // Optimistic flip → requested value. Same setState/view-guard orchestration as `patch`; the pure
  // next-state transform lives in watchState.ts so the watch/schedule rollback logic is unit-testable.
  function patchOptimistic(fullName: string, next: Partial<RepoState>) {
    setView((v) =>
      v.status === "done"
        ? { status: "done", repos: applyWatchOptimistic(v.repos, fullName, next) }
        : v,
    );
  }

  // Rollback → exact prior value, so a non-2xx/network failure can't masquerade as a saved change.
  function patchRollback(fullName: string, prev: Partial<RepoState>) {
    setView((v) =>
      v.status === "done"
        ? { status: "done", repos: rollbackWatch(v.repos, fullName, prev) }
        : v,
    );
  }

  function setRowError(fullName: string, message: string | null) {
    setErrors((e) => {
      if (message === null) {
        if (!e[fullName]) return e;
        const next = { ...e };
        delete next[fullName];
        return next;
      }
      return { ...e, [fullName]: message };
    });
  }

  // Both mutations follow the same contract: optimistic patch → POST → on non-2xx OR network
  // error, roll the row back to its prior value and surface an inline error. Success theater
  // (showing a state the server never saved) on watch/schedule means scans silently never run.
  async function toggleWatch(r: AppRepo, watched: boolean) {
    const prevWatched = r.state?.watched ?? false;
    patchOptimistic(r.fullName, { watched });
    setRowError(r.fullName, null);
    setWatchPending((p) => ({ ...p, [r.fullName]: true }));
    try {
      const res = await fetch("/api/org/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, private: r.private, watched }),
      });
      if (!res.ok) {
        patchRollback(r.fullName, { watched: prevWatched });
        setRowError(r.fullName, `Couldn't ${watched ? "watch" : "unwatch"} — not saved. Try again.`);
      }
    } catch {
      patchRollback(r.fullName, { watched: prevWatched });
      setRowError(r.fullName, "Network error — change not saved. Try again.");
    } finally {
      setWatchPending((p) => {
        const next = { ...p };
        delete next[r.fullName];
        return next;
      });
    }
  }

  async function changeSchedule(r: AppRepo, schedule: string) {
    // Defense in depth: never persist a cadence while this row's watch is still in flight (the select
    // is also disabled then) — an orphaned schedule on an unwatched repo would result if the watch fails.
    if (watchPending[r.fullName]) return;
    const prevSchedule = r.state?.scanSchedule ?? "off";
    patchOptimistic(r.fullName, { scanSchedule: schedule });
    setRowError(r.fullName, null);
    try {
      const res = await fetch("/api/org/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, fullName: r.fullName, schedule }),
      });
      if (!res.ok) {
        patchRollback(r.fullName, { scanSchedule: prevSchedule });
        setRowError(r.fullName, "Couldn't change the schedule — not saved. Try again.");
      }
    } catch {
      patchRollback(r.fullName, { scanSchedule: prevSchedule });
      setRowError(r.fullName, "Network error — schedule not saved. Try again.");
    }
  }

  const repos = useMemo(() => (view.status === "done" ? view.repos : []), [view]);

  const languages = useMemo(
    () => [...new Set(repos.map((r) => r.language).filter((l): l is string => Boolean(l)))].sort(),
    [repos],
  );

  const filtered = useMemo(
    () => filterRepos(repos, { query, visibility, watchedOnly, language }),
    [repos, query, visibility, watchedOnly, language],
  );

  // Watch every currently-filtered repo that isn't watched yet, in one request. Optimistic across the
  // set; rolls failed rows back. Same no-success-theater contract as the per-row toggle.
  async function watchAllFiltered() {
    const targets = filtered.filter((r) => !r.state?.watched);
    if (targets.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMsg(null);
    targets.forEach((r) => patch(r.fullName, { watched: true }));
    try {
      const res = await fetch("/api/org/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org,
          watched: true,
          repos: targets.map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, private: r.private })),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { count?: number; failed?: string[]; error?: string };
      const { revertFullNames, message } = summarizeBulkWatch({
        targetFullNames: targets.map((r) => r.fullName),
        failed: Array.isArray(d.failed) ? d.failed : [],
        responseOk: res.ok,
        error: d.error,
      });
      revertFullNames.forEach((fn) => patch(fn, { watched: false }));
      setBulkMsg(message);
      if (!res.ok) return;
    } catch {
      targets.forEach((r) => patch(r.fullName, { watched: false }));
      setBulkMsg({ kind: "error", text: "Network error — bulk watch not saved." });
    } finally {
      setBulkBusy(false);
    }
  }

  // Set one autoscan cadence across the WHOLE watched set (the schedule route's no-fullName body).
  async function scheduleWatched(schedule: string) {
    if (!schedule || bulkBusy) return;
    const watchedRepos = repos.filter((r) => r.state?.watched);
    if (watchedRepos.length === 0) return;
    setBulkBusy(true);
    setBulkMsg(null);
    const prev = new Map(watchedRepos.map((r) => [r.fullName, r.state?.scanSchedule ?? "off"]));
    watchedRepos.forEach((r) => patch(r.fullName, { scanSchedule: schedule }));
    try {
      const res = await fetch("/api/org/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, schedule }),
      });
      const d = (await res.json().catch(() => ({}))) as { updated?: number; fullNames?: string[]; error?: string };
      if (!res.ok) {
        prev.forEach((s, fn) => patch(fn, { scanSchedule: s }));
        setBulkMsg({ kind: "error", text: d.error ?? "Failed to set schedule." });
        return;
      }
      // Reconcile against exactly the rows the server persisted. The DB only schedules repos watched
      // IN THE DB; if the client's optimistic watched set is larger (a per-row watch still in flight or
      // silently rolled back), those rows weren't saved. Revert any optimistically-patched row the
      // server didn't confirm so it can't show a cadence that will never run (no success theater).
      const confirmed = new Set(
        Array.isArray(d.fullNames) ? d.fullNames : watchedRepos.map((r) => r.fullName),
      );
      const unconfirmed = watchedRepos.filter((r) => !confirmed.has(r.fullName));
      unconfirmed.forEach((r) => patch(r.fullName, { scanSchedule: prev.get(r.fullName) ?? "off" }));
      const n = watchedRepos.length - unconfirmed.length;
      if (unconfirmed.length > 0) {
        setBulkMsg({
          kind: "error",
          text: `Set ${schedule} for ${n} of ${watchedRepos.length} repo${watchedRepos.length === 1 ? "" : "s"} — ${unconfirmed.length} weren't watched on the server and were reverted. Refresh, then retry.`,
        });
      } else {
        setBulkMsg({ kind: "note", text: `Set ${schedule} cadence for ${n} watched repo${n === 1 ? "" : "s"}.` });
      }
    } catch {
      prev.forEach((s, fn) => patch(fn, { scanSchedule: s }));
      setBulkMsg({ kind: "error", text: "Network error — schedule not saved." });
    } finally {
      setBulkBusy(false);
    }
  }

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

  const watchedCount = view.repos.filter((r) => r.state?.watched).length;
  // Live cost line for the watch/schedule decisions being made right here: derived from the SAME
  // rows the list renders (optimistic patches included), so flipping a repo to daily moves the
  // figure instantly. Upper-bound — dedup/degraded runs are refunded (see CREDIT_ESTIMATE_NOTE).
  const scheduledCount = view.repos.filter(
    (r) => r.state?.watched && (r.state?.scanSchedule ?? "off") !== "off",
  ).length;
  const repoStates = view.repos.map((r) => ({ watched: r.state?.watched, schedule: r.state?.scanSchedule }));
  // Raw scheduled runs vs the prepaid credits they actually DRAW: a metered scan is free until the org
  // exceeds its monthly allowance, so subtract the org's remaining free scans (0 when unknown) — the
  // figure no longer overstates the spend for an org whose allowance still covers the schedule.
  const scheduledRuns = scheduledRunsPerMonth(repoStates);
  const allowanceRemaining = credit && !credit.unlimited ? Math.max(0, credit.allowanceRemaining) : 0;
  const monthlyCredits = estimateMonthlyCredits(repoStates, allowanceRemaining);
  const underAMonth =
    credit != null && !credit.unlimited && monthlyCredits > 0 && credit.balance < monthlyCredits;

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

      {/* Cost/quota context at the moment of commitment: schedules below are billable units, so
          say what they add up to — and what's in the tank — before the cron finds out. Hidden
          when nothing is scheduled and no balance could be read (e.g. DB-less local). */}
      {(scheduledRuns > 0 || (credit != null && !credit.unlimited)) && (
        <p className="-mt-2 mb-3 text-sm text-slate-500" title={CREDIT_ESTIMATE_NOTE}>
          {scheduledCount > 0 ? (
            <>
              {scheduledCount} scheduled autoscan{scheduledCount === 1 ? "" : "s"} ≈{" "}
              <span className="font-mono text-slate-300">{scheduledRuns}</span> run
              {scheduledRuns === 1 ? "" : "s"}/month →{" "}
              <span className="font-mono text-slate-300">{monthlyCredits}</span> credit
              {monthlyCredits === 1 ? "" : "s"}/month
              {allowanceRemaining > 0 && (
                <> (after {allowanceRemaining} free scan{allowanceRemaining === 1 ? "" : "s"} left this month)</>
              )}
            </>
          ) : (
            <>Each scheduled autoscan run draws 1 prepaid credit beyond your free monthly allowance</>
          )}
          {credit != null &&
            (credit.unlimited ? (
              <> · unlimited plan</>
            ) : (
              <>
                {" "}
                · balance: <span className="font-mono text-slate-300">{credit.balance}</span>
              </>
            ))}
          {underAMonth && (
            <span className="text-warn"> — covers under a month; autoscans pause at zero</span>
          )}
        </p>
      )}

      {/* Bulk actions across the filtered set — watch many at once, or set one cadence for the
          whole watched set, instead of one click per repo. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={watchAllFiltered}
          disabled={bulkBusy || filtered.every((r) => r.state?.watched)}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 font-mono text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {bulkBusy ? "Working…" : `Watch all (${filtered.filter((r) => !r.state?.watched).length})`}
        </button>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          Schedule watched
          <select
            value=""
            disabled={bulkBusy || watchedCount === 0}
            onChange={(e) => scheduleWatched(e.target.value)}
            aria-label="Set autoscan cadence for all watched repos"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-300 outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">cadence…</option>
            {SCHEDULES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {bulkMsg && (
          <span
            role={bulkMsg.kind === "error" ? "alert" : "status"}
            aria-live={bulkMsg.kind === "error" ? "assertive" : "polite"}
            className={`font-mono text-sm ${bulkMsg.kind === "error" ? "text-danger" : "text-slate-500"}`}
          >
            {bulkMsg.text}
          </span>
        )}
      </div>

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
