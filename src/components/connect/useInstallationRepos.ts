"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { estimateMonthlyCredits, scheduledRunsPerMonth } from "@/lib/credit-estimate";
import type { CreditInfo } from "./InstallationRepos.CreditCostStrip";
import { type AppRepo, type RepoState, type Visibility } from "./installationRepoTypes";
import { applyWatchOptimistic, filterRepos, patchRepoState, rollbackWatch, summarizeBulkWatch } from "./watchState";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; repos: AppRepo[] };

/**
 * Shared AbortController-cancellation dance for a `useEffect` that fires a fetch. The repos, credits,
 * and segments effects each hand-rolled this: create a controller, guard against a stale response
 * landing after a newer effect run superseded it (`active`), and abort + flip `active` false on
 * cleanup. `run` receives the signal to pass to `fetch` and an `isActive()` check to call before any
 * `setState` in a `.then`/`.catch` — same two checks the inline versions made, just named once. The
 * controller is still created synchronously when the effect body runs and cleanup still aborts +
 * marks inactive in the same order, so cancellation timing is byte-for-byte the same as before.
 */
function withAbortableEffect(run: (signal: AbortSignal, isActive: () => boolean) => void): () => void {
  const controller = new AbortController();
  let active = true;
  run(controller.signal, () => active);
  return () => {
    active = false;
    controller.abort();
  };
}

/** Orchestration for <InstallationRepos>: repo/credit/segment fetches, optimistic watch/schedule/segment
 *  mutations (with per-row sequencing + rollback), bulk actions, and the derived credit-cost figures.
 *  Extracted verbatim from the component so the .tsx stays a thin presentational shell — behavior is
 *  identical; the hook simply owns the state/effects/handlers the component used to declare inline. */
export function useInstallationRepos({ org, installationId }: { org: string; installationId?: string }) {
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
    return withAbortableEffect((signal, isActive) => {
      // Intentional: reset to the loading state whenever `org`/`installationId` changes so the
      // heading doesn't show a stale installation's repos while the new fetch is in flight.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView({ status: "loading" });
      const qs = new URLSearchParams({ org });
      if (installationId) qs.set("installation_id", installationId);
      fetch(`/api/app/repos?${qs.toString()}`, { signal })
        .then(async (r) => {
          const data = await r.json();
          if (!isActive()) return;
          if (!r.ok) setView({ status: "error", message: data?.error ?? `Failed (${r.status}).` });
          else setView({ status: "done", repos: (data.repos ?? []) as AppRepo[] });
        })
        .catch(() => {
          if (isActive()) setView({ status: "error", message: "Network error." });
        });
    });
  }, [org, installationId]);

  useEffect(() => {
    // Same cancellation contract as the repo fetch: only the latest org's credit state may land.
    return withAbortableEffect((signal, isActive) => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset so a stale org's balance never shows
      setCredit(null);
      fetch(`/api/org/credits?org=${encodeURIComponent(org)}`, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (isActive() && d && typeof d.balance === "number") {
            setCredit({
              balance: d.balance,
              unlimited: Boolean(d.unlimited),
              allowanceRemaining: typeof d.allowanceRemaining === "number" ? d.allowanceRemaining : 0,
            });
          }
        })
        .catch(() => {});
    });
  }, [org]);

  useEffect(() => {
    // Load this org's segments + membership (best-effort, cancellable — same contract as above).
    return withAbortableEffect((signal, isActive) => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset so a stale org's segments never show
      setSegments([]);
      setSegMembership({});
      fetch(`/api/org/segments?org=${encodeURIComponent(org)}&membership=1`, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!isActive() || !d) return;
          setSegments(Array.isArray(d.segments) ? d.segments : []);
          setSegMembership(d.membership ?? {});
        })
        .catch(() => {});
    });
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

  // Per-row monotonic sequence for the watch/schedule mutations. A rapid double-toggle (watch then
  // unwatch) fires overlapping POSTs; if their responses arrive out of order the row could reconcile
  // to the wrong final state (or a stale non-2xx could roll back a newer optimistic change). Each call
  // bumps the row's counter and only the LATEST request is allowed to touch state — stale responses
  // are ignored, so the row always settles on the last click's intent.
  const watchSeq = useRef<Record<string, number>>({});
  const scheduleSeq = useRef<Record<string, number>>({});

  // Both mutations follow the same contract: optimistic patch → POST → on non-2xx OR network
  // error, roll the row back to its prior value and surface an inline error. Success theater
  // (showing a state the server never saved) on watch/schedule means scans silently never run.
  async function toggleWatch(r: AppRepo, watched: boolean) {
    const prevWatched = r.state?.watched ?? false;
    const seq = (watchSeq.current[r.fullName] = (watchSeq.current[r.fullName] ?? 0) + 1);
    patchOptimistic(r.fullName, { watched });
    setRowError(r.fullName, null);
    setWatchPending((p) => ({ ...p, [r.fullName]: true }));
    try {
      const res = await fetch("/api/org/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, private: r.private, watched }),
      });
      if (watchSeq.current[r.fullName] !== seq) return; // superseded by a newer toggle — it owns the row
      if (!res.ok) {
        patchRollback(r.fullName, { watched: prevWatched });
        setRowError(r.fullName, `Couldn't ${watched ? "watch" : "unwatch"} — not saved. Try again.`);
      }
    } catch {
      if (watchSeq.current[r.fullName] !== seq) return; // superseded — don't roll back a newer change
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
    const seq = (scheduleSeq.current[r.fullName] = (scheduleSeq.current[r.fullName] ?? 0) + 1);
    patchOptimistic(r.fullName, { scanSchedule: schedule });
    setRowError(r.fullName, null);
    try {
      const res = await fetch("/api/org/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, fullName: r.fullName, schedule }),
      });
      if (scheduleSeq.current[r.fullName] !== seq) return; // superseded by a newer schedule change
      if (!res.ok) {
        patchRollback(r.fullName, { scanSchedule: prevSchedule });
        setRowError(r.fullName, "Couldn't change the schedule — not saved. Try again.");
      }
    } catch {
      if (scheduleSeq.current[r.fullName] !== seq) return; // superseded — don't roll back a newer change
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

  // One-click escape from the zero-matches dead end: with four independent filters active (one of
  // which — language — can even hide its own control when `languages` is empty), unwinding them by
  // hand is guesswork. The empty state offers this instead. (ambiguity-ui connect-repo-selection #5)
  function resetFilters() {
    setQuery("");
    setVisibility("all");
    setWatchedOnly(false);
    setLanguage("all");
  }

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

  // Derived credit-cost figures for the commitment strip. Computed only when repos have loaded; the
  // component reads these when view.status === "done" (defaults are inert placeholders otherwise).
  const doneRepos = view.status === "done" ? view.repos : [];
  const watchedCount = doneRepos.filter((r) => r.state?.watched).length;
  // Live cost line for the watch/schedule decisions being made right here: derived from the SAME
  // rows the list renders (optimistic patches included), so flipping a repo to daily moves the
  // figure instantly. Upper-bound — dedup/degraded runs are refunded (see CREDIT_ESTIMATE_NOTE).
  const scheduledCount = doneRepos.filter(
    (r) => r.state?.watched && (r.state?.scanSchedule ?? "off") !== "off",
  ).length;
  const repoStates = doneRepos.map((r) => ({ watched: r.state?.watched, schedule: r.state?.scanSchedule }));
  // Raw scheduled runs vs the prepaid credits they actually DRAW: a metered scan is free until the org
  // exceeds its monthly allowance, so subtract the org's remaining free scans (0 when unknown) — the
  // figure no longer overstates the spend for an org whose allowance still covers the schedule.
  const scheduledRuns = scheduledRunsPerMonth(repoStates);
  const allowanceRemaining = credit && !credit.unlimited ? Math.max(0, credit.allowanceRemaining) : 0;
  const monthlyCredits = estimateMonthlyCredits(repoStates, allowanceRemaining);
  const underAMonth =
    credit != null && !credit.unlimited && monthlyCredits > 0 && credit.balance < monthlyCredits;

  return {
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
    resetFilters,
    languages,
    filtered,
    watchedCount,
    scheduledCount,
    scheduledRuns,
    allowanceRemaining,
    monthlyCredits,
    underAMonth,
  };
}
