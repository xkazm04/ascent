"use client";

// Step 1's repo PICKER — the list of repositories ascent can already see, so mapping a registry is a
// choice rather than a spelling test.
//
// The owner/repo text field it sits above is not replaced, it is demoted: the picker answers the
// common case (the repo exists and the App can see it) and the field answers the rest (a repo outside
// the installation, a name typed from memory, a picker that failed to load). Picking a row writes the
// SAME `fullName` state the field edits, so there is one value, one validation and one POST no matter
// which control produced it.

import { useMemo, useState } from "react";
import { TextInput } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryRepoOption, RegistryRepoOptions } from "./useRegistryRepoOptions";

/** Rows rendered at once. A 400-repo org gets the search box, not a 400-row scroller. */
const MAX_ROWS = 40;

const NO_REPOS: RegistryRepoOption[] = [];

const ROW =
  "focus-ring flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors";

function Row({ repo, selected, onPick }: { repo: RegistryRepoOption; selected: boolean; onPick: () => void }) {
  const looksLikeRegistry = repo.hasLayout === true || repo.fullName.endsWith(`/${DEFAULT_REGISTRY_NAME}`);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onPick}
        className={`${ROW} ${selected ? "bg-surface text-slate-100" : "text-slate-400 hover:bg-surface/60 hover:text-slate-100"}`}
      >
        <span className="truncate font-mono text-sm">{repo.fullName}</span>
        {looksLikeRegistry ? (
          <span className="shrink-0 rounded-full border border-accent/40 px-1.5 font-mono text-[10px] uppercase tracking-widest text-accent">
            {repo.hasLayout ? "has layout" : "name match"}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-600">
          {repo.private ? "private" : "public"} · {timeAgo(repo.pushedAt ?? undefined)}
        </span>
      </button>
    </li>
  );
}

export function RegistryRepoPicker({
  options,
  value,
  onPick,
}: {
  options: RegistryRepoOptions;
  /** The current `owner/repo`, so the row that matches it reads as selected. */
  value: string;
  onPick: (fullName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const repos = options.status === "done" ? options.repos : NO_REPOS;
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? repos.filter((r) => r.fullName.toLowerCase().includes(needle)) : repos),
    [repos, needle],
  );

  if (options.status === "loading") {
    return <p className="text-xs text-slate-500">Reading the repositories ascent can see…</p>;
  }
  // Both failure shapes degrade to the same place — the text field below — so they say so rather than
  // leaving an empty box that reads as "your org has no repositories".
  if (options.status === "error") {
    return <p className="text-xs text-slate-500">{options.message} Type the repository below instead.</p>;
  }
  if (options.status === "idle" || repos.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72">
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}…`}
            aria-label="Filter repositories"
          />
        </div>
        {value ? <span className="font-mono text-xs text-slate-500">selected · {value}</span> : null}
      </div>
      {matches.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-divider bg-ink/60 p-1">
          {matches.slice(0, MAX_ROWS).map((r) => (
            <Row key={r.fullName} repo={r} selected={r.fullName === value.trim()} onPick={() => onPick(r.fullName)} />
          ))}
        </ul>
      )}
      {matches.length > MAX_ROWS ? (
        <p className="font-mono text-xs text-slate-600">
          showing {MAX_ROWS} of {matches.length} — narrow the filter to see the rest
        </p>
      ) : null}
    </div>
  );
}
