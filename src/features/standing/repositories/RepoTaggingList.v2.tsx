"use client";

// Per-repo segment toggles. Same membership flip as RepoTaggingList; the row is ruled, not a filled chip.
import { useId } from "react";
import { Caption, FormField, HairlineList, Input } from "@/components/kit";
import type { RepoItem, SegmentItem } from "./RepoSegmentsPanel";

export function RepoTaggingListV2({
  segments,
  visibleRepos,
  membership,
  filter,
  setFilter,
  toggle,
  repos,
}: {
  segments: SegmentItem[];
  visibleRepos: RepoItem[];
  membership: Record<string, string[]>;
  filter: string;
  setFilter: (v: string) => void;
  toggle: (fullName: string, segId: string) => void;
  repos: RepoItem[];
}) {
  const filterId = useId();
  return (
    <div className="mt-6 border-t border-divider pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="type-body font-medium text-white">Tag repositories</h3>
        <FormField label="Filter repositories" htmlFor={filterId} className="w-56">
          <Input id={filterId} value={filter} placeholder="Filter repos…" onChange={(e) => setFilter(e.target.value)} />
        </FormField>
      </div>
      <HairlineList className="mt-3 max-h-96 overflow-y-auto" aria-label="Tag repositories">
        {visibleRepos.map((r) => {
          const ids = new Set(membership[r.fullName] ?? []);
          return (
            <li key={r.fullName} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate type-body-sm text-slate-200" title={r.fullName}>
                {r.fullName}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {segments.map((s) => {
                  const on = ids.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(r.fullName, s.id)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1 border px-2 py-0.5 type-body-sm ${on ? "border-white text-white" : "border-divider text-slate-400"}`}
                    >
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </HairlineList>
      {visibleRepos.length === 0 && <Caption className="mt-3">No repos match &quot;{filter}&quot;.</Caption>}
      <Caption className="mt-2">
        {segments.length} segment{segments.length === 1 ? "" : "s"} · {repos.length} repos
      </Caption>
    </div>
  );
}
