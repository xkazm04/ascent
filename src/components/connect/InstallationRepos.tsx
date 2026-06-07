"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LEVEL_CLASSES, timeAgo } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

interface RepoState {
  watched: boolean;
  scanSchedule: string;
  level: string | null;
  overall: number | null;
}
interface AppRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  url: string;
  language: string | null;
  stars: number;
  pushedAt: string | null;
  state: RepoState | null;
}

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; repos: AppRepo[] };

type Visibility = "all" | "public" | "private";

const SCHEDULES = ["off", "daily", "weekly", "monthly"];

/** Skeleton rows that mirror the real row layout, so the panel keeps a stable height and
 *  signals structure before GitHub responds (no spinner → snap-in layout shift). */
function RepoListSkeleton() {
  return (
    <div>
      <div className="mb-3 h-4 w-40 animate-pulse rounded bg-slate-800" />
      <div
        className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"
        aria-hidden
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <div className="min-w-0 flex-1">
              <div className="h-4 w-48 animate-pulse rounded bg-slate-800" />
              <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-800/70" />
            </div>
            <div className="h-4 w-12 animate-pulse rounded bg-slate-800/70" />
            <div className="h-7 w-24 animate-pulse rounded-md bg-slate-800/70" />
            <div className="h-8 w-16 animate-pulse rounded-lg bg-slate-800/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstallationRepos({ org, installationId }: { org: string; installationId?: string }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Search / filter state (Phase 7 — large orgs have hundreds of repos).
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [language, setLanguage] = useState("all");

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

  function patch(fullName: string, next: Partial<RepoState>) {
    setView((v) =>
      v.status === "done"
        ? {
            status: "done",
            repos: v.repos.map((r) =>
              r.fullName === fullName
                ? { ...r, state: { watched: false, scanSchedule: "off", level: null, overall: null, ...r.state, ...next } }
                : r,
            ),
          }
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
    patch(r.fullName, { watched });
    setRowError(r.fullName, null);
    try {
      const res = await fetch("/api/org/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, private: r.private, watched }),
      });
      if (!res.ok) {
        patch(r.fullName, { watched: prevWatched });
        setRowError(r.fullName, `Couldn't ${watched ? "watch" : "unwatch"} — not saved. Try again.`);
      }
    } catch {
      patch(r.fullName, { watched: prevWatched });
      setRowError(r.fullName, "Network error — change not saved. Try again.");
    }
  }

  async function changeSchedule(r: AppRepo, schedule: string) {
    const prevSchedule = r.state?.scanSchedule ?? "off";
    patch(r.fullName, { scanSchedule: schedule });
    setRowError(r.fullName, null);
    try {
      const res = await fetch("/api/org/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, fullName: r.fullName, schedule }),
      });
      if (!res.ok) {
        patch(r.fullName, { scanSchedule: prevSchedule });
        setRowError(r.fullName, "Couldn't change the schedule — not saved. Try again.");
      }
    } catch {
      patch(r.fullName, { scanSchedule: prevSchedule });
      setRowError(r.fullName, "Network error — schedule not saved. Try again.");
    }
  }

  const repos = view.status === "done" ? view.repos : [];

  const languages = useMemo(
    () => [...new Set(repos.map((r) => r.language).filter((l): l is string => Boolean(l)))].sort(),
    [repos],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos.filter((r) => {
      if (q && !r.fullName.toLowerCase().includes(q) && !(r.language ?? "").toLowerCase().includes(q)) return false;
      if (visibility === "public" && r.private) return false;
      if (visibility === "private" && !r.private) return false;
      if (watchedOnly && !r.state?.watched) return false;
      if (language !== "all" && r.language !== language) return false;
      return true;
    });
  }, [repos, query, visibility, watchedOnly, language]);

  if (view.status === "loading") return <RepoListSkeleton />;
  if (view.status === "error")
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm text-danger-soft">
        {view.message}
      </div>
    );
  if (view.repos.length === 0)
    return (
      <EmptyState
        variant="section"
        body="No repositories accessible to this installation. Adjust access on GitHub, then refresh."
      />
    );

  const watchedCount = view.repos.filter((r) => r.state?.watched).length;
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-widest transition ${
      active ? "border-accent bg-accent/10 text-accent" : "border-slate-700 text-slate-400 hover:border-slate-600"
    }`;

  return (
    <div className="animate-fade-up">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-400">
          <span className="font-semibold text-white">{watchedCount}</span> of {view.repos.length} watched
        </span>
        <Link
          href={`/org/${encodeURIComponent(org)}`}
          className="rounded-lg border border-accent/40 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-accent hover:bg-accent/10"
        >
          Org dashboard →
        </Link>
      </div>

      {/* Search + filters — type to find a repo instead of scrolling hundreds. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search repositories…"
          aria-label="Search repositories"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "public", "private"] as Visibility[]).map((v) => (
            <button key={v} type="button" onClick={() => setVisibility(v)} className={chip(visibility === v)}>
              {v}
            </button>
          ))}
          <button type="button" onClick={() => setWatchedOnly((w) => !w)} className={chip(watchedOnly)} aria-pressed={watchedOnly}>
            watched
          </button>
          {languages.length > 0 && (
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Filter by language"
              className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-[11px] text-slate-300 outline-none focus:border-accent"
            >
              <option value="all">all languages</option>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState variant="section" body="No repositories match your search and filters." />
      ) : (
        <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {filtered.map((r) => {
            const st = r.state;
            const lc = st?.level ? LEVEL_CLASSES[st.level as LevelId] : null;
            const rowError = errors[r.fullName];
            return (
              <div key={r.fullName} className="p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-sm text-white">{r.fullName}</span>
                      {r.private ? (
                        <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-accent">
                          private
                        </span>
                      ) : null}
                      {st?.level && lc && (
                        <span className={`rounded border ${lc.border} ${lc.bg} px-1.5 py-0.5 font-mono text-[10px] ${lc.text}`}>
                          {st.level} · {st.overall}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      {r.language && <span>{r.language}</span>}
                      <span>★ {r.stars.toLocaleString()}</span>
                      <span>updated {timeAgo(r.pushedAt ?? undefined)}</span>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={Boolean(st?.watched)}
                      onChange={(e) => toggleWatch(r, e.target.checked)}
                      className="h-4 w-4 accent-accent"
                    />
                    watch
                  </label>

                  <select
                    value={st?.scanSchedule ?? "off"}
                    onChange={(e) => changeSchedule(r, e.target.value)}
                    disabled={!st?.watched}
                    aria-label="Autoscan schedule"
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 outline-none focus:border-accent disabled:opacity-40"
                  >
                    {SCHEDULES.map((s) => (
                      <option key={s} value={s}>
                        {s === "off" ? "no autoscan" : s}
                      </option>
                    ))}
                  </select>

                  <span aria-hidden className="hidden h-7 w-px self-center bg-slate-800 sm:block" />
                  <Link
                    href={`/report?repo=${encodeURIComponent(r.fullName)}`}
                    className="focus-ring shrink-0 rounded-lg bg-accent px-4 py-2 font-mono text-xs font-semibold uppercase tracking-widest text-on-accent transition hover:bg-accent-soft"
                  >
                    Scan
                  </Link>
                </div>
                {rowError && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {rowError}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
