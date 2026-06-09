"use client";

import Link from "next/link";
import { LEVEL_CLASSES, LEVEL_GLYPH, timeAgo } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { type AppRepo, SCHEDULES } from "./installationRepoTypes";

export function RepoRow({
  r,
  rowError,
  onToggleWatch,
  onChangeSchedule,
}: {
  r: AppRepo;
  rowError: string | undefined;
  onToggleWatch: (r: AppRepo, watched: boolean) => void;
  onChangeSchedule: (r: AppRepo, schedule: string) => void;
}) {
  const st = r.state;
  const lc = st?.level ? LEVEL_CLASSES[st.level as LevelId] : null;
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-base text-white">{r.fullName}</span>
            {r.private ? (
              <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-accent">
                private
              </span>
            ) : null}
            {st?.level && lc && (
              <span className={`rounded border ${lc.border} ${lc.bg} px-1.5 py-0.5 font-mono text-sm ${lc.text}`}>
                <span aria-hidden>{LEVEL_GLYPH[st.level as LevelId]} </span>
                {st.level} · {st.overall}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-slate-500">
            {r.language && <span>{r.language}</span>}
            <span>★ {r.stars.toLocaleString()}</span>
            <span>updated {timeAgo(r.pushedAt ?? undefined)}</span>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={Boolean(st?.watched)}
            onChange={(e) => onToggleWatch(r, e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          watch
        </label>

        <select
          value={st?.scanSchedule ?? "off"}
          onChange={(e) => onChangeSchedule(r, e.target.value)}
          disabled={!st?.watched}
          aria-label="Autoscan schedule"
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-40"
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
          className="focus-ring shrink-0 rounded-lg bg-accent px-4 py-2 font-mono text-sm font-semibold uppercase tracking-widest text-on-accent transition hover:bg-accent-soft"
        >
          Scan
        </Link>
      </div>
      {rowError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {rowError}
        </p>
      )}
    </div>
  );
}
