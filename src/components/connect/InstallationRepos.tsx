"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { RepoFilterBar } from "./RepoFilterBar";
import { RepoListSkeleton } from "./RepoListSkeleton";
import { RepoRow } from "./RepoRow";
import { type AppRepo, type RepoState, type Visibility } from "./installationRepoTypes";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; repos: AppRepo[] };

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
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-5 text-base text-danger-soft">
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
