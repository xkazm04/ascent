"use client";

// The repos ascent can already see. Picking a row writes the same owner/repo the field edits.

import { useMemo, useState } from "react";
import { Caption, Chip, FormField, HairlineList, Input, ListRow } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import type { RegistryRepoOption, RegistryRepoOptions } from "./useRegistryRepoOptions";

const MAX_ROWS = 40;
const NONE: RegistryRepoOption[] = [];

export function RegistryPickerV2({
  options,
  value,
  onPick,
}: {
  options: RegistryRepoOptions;
  value: string;
  onPick: (fullName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const repos = options.status === "done" ? options.repos : NONE;
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? repos.filter((r) => r.fullName.toLowerCase().includes(needle)) : repos),
    [repos, needle],
  );

  if (options.status === "loading") {
    return <p className="type-note text-slate-400">Reading the repositories ascent can see…</p>;
  }
  if (options.status === "error") {
    return <p className="type-note text-slate-400">{options.message} Type the repository below instead.</p>;
  }
  if (options.status === "idle" || repos.length === 0) return null;

  const shown = matches.slice(0, MAX_ROWS);
  return (
    <div className="space-y-2">
      <FormField label="Filter repositories" htmlFor="registry-repo-filter">
        <Input
          id="registry-repo-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}…`}
          aria-label="Filter repositories"
        />
      </FormField>
      {value ? <Caption>selected: {value}</Caption> : null}
      {matches.length === 0 ? (
        <p className="type-note text-slate-400">Nothing matches &quot;{query.trim()}&quot;.</p>
      ) : (
        <HairlineList className="max-h-64 list-none overflow-y-auto">
          {shown.map((r) => {
            const named = r.fullName.endsWith(`/${DEFAULT_REGISTRY_NAME}`);
            const mark = r.hasLayout ? "has layout" : named ? "name match" : null;
            return (
              <ListRow
                key={r.fullName}
                selected={r.fullName === value.trim()}
                onPress={() => onPick(r.fullName)}
                title={r.fullName}
                detail={`${r.private ? "private" : "public"} · ${timeAgo(r.pushedAt ?? undefined)}`}
                trailing={mark ? <Chip tone="neutral">{mark}</Chip> : undefined}
              />
            );
          })}
        </HairlineList>
      )}
      {matches.length > MAX_ROWS ? (
        <Caption>
          Showing {MAX_ROWS} of {matches.length}. Narrow the filter to see the rest.
        </Caption>
      ) : null}
    </div>
  );
}
