// The Blueprint direction's spine: the registry repo drawn as a mono FILE MAP — every path in the v1
// layout, its item count, the short hash/sha where one exists, and a one-line note. Paths that ascent
// generates (catalog.json) are marked as such, because "who writes this file" is the single most
// load-bearing fact about the registry: everything else is yours.
//
// Server-safe (no hooks). Renders the same rows whether the registry exists or not — an unmapped
// registry shows the layout that WOULD be scaffolded, greyed, which is far more informative than an
// empty state.

import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { registryTree, shortSha } from "./registryModel";

export function RegistryTreeMap({ view }: { view: RegistryView }) {
  const rows = registryTree(view);
  const mapped = view.status !== "unmapped";
  const root = view.registry?.fullName ?? `${"<org>"}/ai-registry`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Repo layout</Kicker>
        <span className="font-mono text-xs text-slate-500">
          {mapped ? `HEAD ${shortSha(view.registry?.lastIndexSha)} · ${view.registry?.defaultBranch}` : "not scaffolded — this is what the PR adds"}
        </span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-divider bg-surface-strong/40">
        <div className="border-b border-divider px-4 py-2 font-mono text-sm text-white">{root}/</div>
        <ul className="divide-y divide-divider">
          {rows.map((n, i) => {
            const last = i === rows.length - 1;
            const muted = !mapped || (n.count != null && n.count === 0);
            return (
              <li key={n.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2">
                <span className="select-none font-mono text-xs text-slate-700" aria-hidden>
                  {last ? "└─" : "├─"}
                </span>
                <span className={`font-mono text-sm ${muted ? "text-slate-500" : n.kind === "dir" ? "text-accent" : "text-slate-200"}`}>
                  {n.path}
                </span>
                {n.count != null ? (
                  <span className={`font-mono text-sm tabular-nums ${muted ? "text-slate-600" : "text-white"}`}>{n.count}</span>
                ) : null}
                {n.generated ? (
                  <span className="rounded border border-divider px-1.5 font-mono text-xs uppercase tracking-[0.14em] text-slate-500">
                    generated
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-xs text-slate-500">{n.note}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
