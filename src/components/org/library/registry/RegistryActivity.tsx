// The registry's activity feed — the last 20 index/catalog/artifact events, as a dated editorial list.
// Shared by all three directions (the Ledger reads it as a column of dated entries, the Blueprint as a
// change log beside the tree, the Pipeline as the invoke edge's tail). Server-safe.

import { Kicker } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import type { RegistryActivityKind, RegistryView } from "@/lib/org/registry-view";

/** The kind's short mono tag. Real registry nouns, not decorative icons. */
const KIND_TAG: Record<RegistryActivityKind, string> = {
  "skill-version": "skill",
  lesson: "lesson",
  practice: "practice",
  memory: "memory",
  catalog: "catalog",
  index: "index",
};

export function RegistryActivity({ view, limit = 8 }: { view: RegistryView; limit?: number }) {
  const rows = view.activity.slice(0, limit);
  return (
    <div>
      <Kicker tone="muted">Registry activity</Kicker>
      {rows.length === 0 ? (
        <InlineEmpty>
          Nothing indexed yet. The first entry appears when ascent reads the registry&apos;s default branch.
        </InlineEmpty>
      ) : (
        <ul className="mt-2 divide-y divide-divider">
          {rows.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <span className="w-16 shrink-0 font-mono text-xs uppercase tracking-[0.16em] text-slate-500">{KIND_TAG[a.kind]}</span>
              <span className="min-w-0 flex-1 text-sm text-slate-300">
                {a.url ? (
                  <a href={a.url} className="transition hover:text-white">
                    {a.title}
                  </a>
                ) : (
                  a.title
                )}
              </span>
              <span className="font-mono text-xs tabular-nums text-slate-600">{timeAgo(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
