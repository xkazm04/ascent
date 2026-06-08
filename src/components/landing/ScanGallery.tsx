// Landing-page discovery: a live "recently scanned" rail + a "most AI-native" leaderboard,
// sourced from persisted public scans (see getPublicScanGallery). Every card links to the
// repo's permalinked report. Server component — pure links, no client state.

import Link from "next/link";
import type { LevelId } from "@/lib/types";
import type { PublicRepoCard, PublicScanGallery } from "@/lib/db";
import { LEVEL_CLASSES, LEVEL_GLYPH, scoreHex, timeAgo } from "@/lib/ui";

function levelClasses(level: string) {
  return LEVEL_CLASSES[level as LevelId] ?? LEVEL_CLASSES.L1;
}

function levelGlyph(level: string) {
  return LEVEL_GLYPH[level as LevelId] ?? LEVEL_GLYPH.L1;
}

/** A compact, fixed-width card for the horizontally-scrolling "recently scanned" rail. */
function RailCard({ c }: { c: PublicRepoCard }) {
  const lc = levelClasses(c.level);
  return (
    <Link
      href={c.href}
      className="focus-ring group flex w-60 shrink-0 flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition hover:border-accent/60 hover:bg-slate-900/70"
    >
      <div className="flex items-center justify-between">
        <span className={`font-mono text-sm font-bold ${lc.text}`}>
          <span aria-hidden>{levelGlyph(c.level)}</span> {c.level}
        </span>
        <span className="font-mono text-lg font-bold tabular-nums" style={{ color: scoreHex(c.overall) }}>
          {c.overall}
        </span>
      </div>
      <div className="mt-2 truncate font-mono text-base text-white group-hover:text-accent" title={c.fullName}>
        {c.fullName}
      </div>
      <div className="mt-1 flex items-center gap-1.5 truncate font-mono text-sm uppercase tracking-widest text-slate-500">
        <span>{c.levelName}</span>
        <span aria-hidden>·</span>
        <span>{timeAgo(c.scannedAt)}</span>
        {c.primaryLanguage && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate normal-case tracking-normal">{c.primaryLanguage}</span>
          </>
        )}
      </div>
    </Link>
  );
}

/** A ranked row for the "most AI-native" leaderboard. */
function LeaderRow({ c, rank }: { c: PublicRepoCard; rank: number }) {
  const lc = levelClasses(c.level);
  return (
    <Link
      href={c.href}
      className="focus-ring group flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 transition hover:border-accent/60 hover:bg-slate-900/70"
    >
      <span className="w-6 shrink-0 text-center font-mono text-base font-bold text-slate-500">{rank}</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-base text-white group-hover:text-accent"
        title={c.fullName}
      >
        {c.fullName}
      </span>
      <span className={`hidden shrink-0 items-center gap-1 font-mono text-sm sm:flex ${lc.text}`}>
        <span aria-hidden>{levelGlyph(c.level)}</span> {c.level} {c.levelName}
      </span>
      <span
        className="w-9 shrink-0 text-right font-mono text-base font-bold tabular-nums"
        style={{ color: scoreHex(c.overall) }}
      >
        {c.overall}
      </span>
    </Link>
  );
}

export function ScanGallery({ gallery }: { gallery: PublicScanGallery }) {
  const { recent, topAiNative, totalRepos } = gallery;
  const top = topAiNative[0];

  return (
    <section className="scroll-mt-20 py-12">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Live from the index</div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-bold text-white">Recently scanned</h2>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          {totalRepos} public {totalRepos === 1 ? "repo" : "repos"} scored
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-slate-400">
        Real repositories, freshly read by Ascent. Open any report — it&apos;s a permalinked snapshot.
      </p>

      {/* Horizontally-scrolling rail of recent scans. */}
      <div className="mt-6 overflow-x-auto pb-2">
        <div className="flex gap-3">
          {recent.map((c) => (
            <RailCard key={c.fullName} c={c} />
          ))}
        </div>
      </div>

      {/* Leaderboard — framed as a challenge to pull visitors into a scan. */}
      {topAiNative.length > 0 && (
        <div className="mt-10">
          <h3 className="text-lg font-semibold text-white">Most AI-native repos</h3>
          <p className="mt-1 max-w-2xl text-slate-400">
            The highest-scoring repositories on the index.
            {top && (
              <>
                {" "}
                See how your repo ranks against{" "}
                <span className="font-mono text-slate-300">{top.fullName}</span>.
              </>
            )}
          </p>
          <div className="mt-4 grid gap-2">
            {topAiNative.map((c, i) => (
              <LeaderRow key={c.fullName} c={c} rank={i + 1} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
