"use client";

// Prism list of watched repos absent from GitHub's last complete listing. Same unwatch POST as
// MissingReposPanel. The name stays text: RepoRow's link cannot open an external URL in a new tab.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Caption, Chip, Frame, GhostAction, HairlineList, Lede, RepoRow, RepoRowCell, SectionHead } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import type { MissingRepoRow } from "./MissingReposPanel";

const ABSENCE_HINT =
  "These watched repos were absent from GitHub's last complete listing of this organization: renamed, transferred, made private, or deleted. The listing cannot tell those apart. Each keeps taking a scheduled-rescan slot and failing until it is unwatched.";

export function MissingReposPanelV2({ org, repos }: { org: string; repos: MissingRepoRow[] }) {
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
      setCleared((c) => [...c, repo.fullName]);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Frame edge="top" pad="md" aria-label="Missing from GitHub">
      <SectionHead eyebrow="Missing from GitHub" title="Absent from the listing" named={String(rows.length)} />
      <Lede className="mt-3">Nothing is removed automatically; unwatch when you&apos;ve confirmed. Scan history is kept either way.</Lede>
      <Caption className="mt-2" tone="note">{ABSENCE_HINT}</Caption>
      <HairlineList className="mt-4" aria-label="Repositories missing from GitHub">
        {rows.map((r) => {
          const since = r.missingSince.slice(0, 10);
          return (
            <RepoRow
              key={r.fullName}
              name={r.fullName}
              score={null}
              scoreLabel={`${r.fullName} is absent from the listing, not an unscored repository`}
              chips={<Chip>missing from GitHub</Chip>}
              cells={
                <RepoRowCell label="Missing since" title={`First missing on ${since}`}>
                  {since} ({timeAgo(r.missingSince)})
                </RepoRowCell>
              }
              actions={
                <>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    data-kit="action"
                    data-kind="ghost"
                    className="focus-ring inline-flex items-center rounded-lg border border-divider px-3 py-2 type-body-sm font-semibold text-slate-200"
                  >
                    Open
                  </a>
                  <GhostAction onClick={() => unwatch(r)} disabled={pending !== null} aria-label={`Unwatch ${r.fullName}`}>
                    {pending === r.fullName ? "Unwatching…" : "Unwatch"}
                  </GhostAction>
                </>
              }
            />
          );
        })}
      </HairlineList>
      {error && (
        <p role="alert" className="mt-3 type-body-sm text-slate-100">
          <span aria-hidden>! </span>
          {error}
        </p>
      )}
    </Frame>
  );
}
