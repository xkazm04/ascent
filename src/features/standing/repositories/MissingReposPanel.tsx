"use client";

// Watchlist entries GitHub no longer lists. Import upserts on (orgId, fullName), so re-importing an
// org never duplicates a row — but until reconcileListedRepos nothing noticed REMOVALS: a repo
// renamed, transferred, deleted or turned private kept winning a slot in the 100/day rescan cap,
// failed, took the 6h backoff, and repeated invisibly. This is the surface that makes that visible
// and gives it a one-click end.
//
// Deliberately a NUDGE, not an eviction. A rename is indistinguishable from a deletion at the listing
// level, so the date is shown and the user judges: unwatching is THEIR action. Nothing here deletes a
// repository row or its scan history — the rollups deliberately include repos with scans.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Surface, Kicker } from "@/components/ui";
import { timeAgo } from "@/lib/ui";

export interface MissingRepoRow {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  /** ISO timestamp of the first complete listing that came back without this repo. */
  missingSince: string;
}

export function MissingReposPanel({ org, repos }: { org: string; repos: MissingRepoRow[] }) {
  const router = useRouter();
  const [cleared, setCleared] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = repos.filter((r) => !cleared.includes(r.fullName));
  if (rows.length === 0) return null;

  async function unwatch(repo: MissingRepoRow) {
    if (pending) return;
    setPending(repo.fullName);
    setError(null);
    try {
      const res = await fetch("/api/org/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          url: repo.url,
          watched: false,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? `Could not unwatch (${res.status}).`);
        return;
      }
      // Drop the row optimistically so the list shrinks as the user works through it, then pull the
      // server's truth (the repo also leaves the leaderboard's watched controls).
      setCleared((c) => [...c, repo.fullName]);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Missing from GitHub</Kicker>
        <span className="font-mono text-sm tabular-nums text-slate-500">{rows.length}</span>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {rows.length === 1 ? "This watched repo was" : `These ${rows.length} watched repos were`} absent from the
        last complete listing of <span className="font-mono">{org}</span>: renamed, transferred, made private, or
        deleted. {rows.length === 1 ? "It keeps" : "They keep"} taking a scheduled-rescan slot and failing. Nothing
        is removed automatically; unwatch when you&apos;ve confirmed. Scan history is kept either way.
      </p>
      <ul className="mt-3 divide-y divide-divider border-t border-divider">
        {rows.map((r) => (
          <li key={r.fullName} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring truncate font-mono text-sm text-slate-300 transition hover:text-accent"
              >
                {r.fullName}
              </a>
              <span
                className="ml-2 font-mono text-sm tabular-nums text-warn"
                title={`First missing on ${r.missingSince.slice(0, 10)}`}
              >
                missing since {r.missingSince.slice(0, 10)} ({timeAgo(r.missingSince)})
              </span>
            </span>
            <button
              type="button"
              onClick={() => unwatch(r)}
              aria-disabled={pending !== null || undefined}
              aria-label={`Unwatch ${r.fullName}`}
              className={`rounded-md border border-slate-700 px-2 py-1 font-mono text-sm text-slate-300 transition focus:border-accent focus:outline-none ${
                pending !== null ? "cursor-not-allowed opacity-50" : "hover:border-accent hover:text-white"
              }`}
            >
              {pending === r.fullName ? "Unwatching…" : "Unwatch"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Surface>
  );
}
