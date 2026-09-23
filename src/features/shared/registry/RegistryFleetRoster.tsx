// The fleet's to-do list for step 5: every swept repo that does NOT point at this registry, named,
// with its reason and the exact line that fixes it. "27/34 pointing" tells an operator how far along
// they are; this tells them which repo to open next. Server-safe (no hooks, no handlers).
//
// Three reasons, kept apart because they are different jobs: a manifest that names ANOTHER registry
// (repoint it), a manifest with no pointer (add one line), and no manifest at all (add the file).
// Repos whose pointer has not been read yet are counted, never listed as missing one.

import type { FleetRosterEntry } from "@/lib/org/registry-view";

/** Enough rows to act on; the rest are counted rather than dropped silently. */
export const ROSTER_CAP = 20;

function Reason({ entry }: { entry: FleetRosterEntry }) {
  if (entry.state === "elsewhere") {
    return (
      <span className="text-slate-400">
        points at <span className="font-mono text-slate-300">{entry.remote}</span>
      </span>
    );
  }
  return <span className="text-slate-400">{entry.state === "no-manifest" ? "no .ai/manifest.yaml; add one with" : "manifest names no registry; add"}</span>;
}

export function RegistryFleetRoster({
  roster,
  unswept = 0,
  pointer,
}: {
  roster: FleetRosterEntry[];
  unswept?: number;
  /** The exact line to paste, from the view's how-to (`registry.remote: github:<registry>`). */
  pointer: string;
}) {
  const todo = roster.filter((e) => e.state !== "pointing");
  const shown = todo.slice(0, ROSTER_CAP);
  const unread =
    unswept > 0 ? (
      <p className="type-caption text-slate-500" data-roster-unswept={unswept}>
        {unswept} repo{unswept === 1 ? "" : "s"} not read yet: the next conformance sweep reads {unswept === 1 ? "its" : "their"} manifest
        {unswept === 1 ? "" : "s"}.
      </p>
    ) : null;

  if (!todo.length) {
    return (
      <div className="space-y-1" data-fleet-roster="clear">
        <p className="type-body-sm text-slate-400">Every swept repo points at this registry.</p>
        {unread}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-fleet-roster="todo">
      <p className="type-caption uppercase tracking-widest text-slate-500">
        Not pointing here · {todo.length}
      </p>
      <ul className="divide-y divide-divider rounded-xl border border-divider">
        {shown.map((e) => (
          <li key={e.repoFullName} data-roster-repo={e.repoFullName} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-surface/40 px-4 py-2 type-body-sm">
            <span className="font-mono text-slate-200">{e.repoFullName}</span>
            <Reason entry={e} />
            {e.state === "elsewhere" ? null : (
              <code data-pointer-line className="font-mono text-slate-300">
                {pointer}
              </code>
            )}
          </li>
        ))}
      </ul>
      {todo.length > shown.length ? (
        <p className="type-caption text-slate-500">and {todo.length - shown.length} more</p>
      ) : null}
      {unread}
    </div>
  );
}
