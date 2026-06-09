"use client";

import type { Visibility } from "./installationRepoTypes";

export function RepoFilterBar({
  query,
  setQuery,
  visibility,
  setVisibility,
  watchedOnly,
  setWatchedOnly,
  language,
  setLanguage,
  languages,
}: {
  query: string;
  setQuery: (value: string) => void;
  visibility: Visibility;
  setVisibility: (value: Visibility) => void;
  watchedOnly: boolean;
  setWatchedOnly: (fn: (w: boolean) => boolean) => void;
  language: string;
  setLanguage: (value: string) => void;
  languages: string[];
}) {
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 font-mono text-sm uppercase tracking-widest transition ${
      active ? "border-accent bg-accent/10 text-accent" : "border-slate-700 text-slate-400 hover:border-slate-600"
    }`;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search repositories…"
        aria-label="Search repositories"
        className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-white outline-none focus:border-accent"
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
            className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 font-mono text-sm text-slate-300 outline-none focus:border-accent"
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
  );
}
