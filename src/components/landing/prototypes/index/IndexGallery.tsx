"use client";

// Live discovery for The Index — a ranked editorial register of the most AI-native repos, plus a thin
// "latest" line. Only rendered when persisted public scans exist.

import Link from "next/link";
import type { PublicScanGallery } from "@/lib/db";
import { scoreHex, timeAgo } from "@/lib/ui";
import { Kicker } from "@/components/ui";

export function IndexGallery({ gallery }: { gallery: PublicScanGallery }) {
  const { recent, topAiNative, totalRepos } = gallery;
  const board = topAiNative.length > 0 ? topAiNative : recent;
  return (
    <section id="gallery" className="flex min-h-screen snap-start flex-col justify-center pb-10 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <Kicker>Live from the index</Kicker>
          <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">The register</h2>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
          {totalRepos} public {totalRepos === 1 ? "repo" : "repos"} rated
        </span>
      </div>

      <div className="divide-y divide-slate-800">
        {board.map((c, i) => (
          <Link
            key={c.fullName}
            href={c.href}
            className="focus-ring group grid grid-cols-[2rem_1fr_auto] items-center gap-4 py-4 transition"
          >
            <span className="font-mono text-sm tabular-nums text-slate-600">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-white group-hover:text-accent" title={c.fullName}>
                {c.fullName}
              </span>
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
                {c.levelName} · {timeAgo(c.scannedAt)}
              </span>
            </span>
            <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(c.overall) }}>
              {c.overall}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
