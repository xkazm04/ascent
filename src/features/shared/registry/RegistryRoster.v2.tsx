// Repos that do not point here. Names and the line that fixes them, no score color.

import { Caption, HairlineList, MonoPath } from "@/components/kit";
import type { FleetRosterEntry } from "@/lib/org/registry-view";

const ROSTER_CAP = 20;

function Reason({ entry }: { entry: FleetRosterEntry }) {
  if (entry.state === "elsewhere") {
    return (
      <span className="text-slate-400">
        points at <MonoPath>{entry.remote}</MonoPath>
      </span>
    );
  }
  return (
    <span className="text-slate-400">
      {entry.state === "no-manifest" ? "no .ai/manifest.yaml; add one with" : "manifest names no registry; add"}
    </span>
  );
}

export function RegistryRosterV2({
  roster,
  unswept = 0,
  pointer,
}: {
  roster: FleetRosterEntry[];
  unswept?: number;
  pointer: string;
}) {
  const todo = roster.filter((e) => e.state !== "pointing");
  const shown = todo.slice(0, ROSTER_CAP);
  const unread =
    unswept > 0 ? (
      <div data-roster-unswept={unswept}>
        <Caption>
          {unswept} repo{unswept === 1 ? "" : "s"} not read yet: the next conformance sweep reads {unswept === 1 ? "its" : "their"} manifest
          {unswept === 1 ? "" : "s"}.
        </Caption>
      </div>
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
    <div className="mt-4 space-y-2" data-fleet-roster="todo">
      <Caption>Not pointing here: {todo.length}</Caption>
      <HairlineList className="list-none">
        {shown.map((e) => (
          <li key={e.repoFullName} data-roster-repo={e.repoFullName} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 type-body-sm">
            <MonoPath>{e.repoFullName}</MonoPath>
            <Reason entry={e} />
            {e.state === "elsewhere" ? null : (
              <span data-pointer-line>
                <MonoPath>{pointer}</MonoPath>
              </span>
            )}
          </li>
        ))}
      </HairlineList>
      {todo.length > shown.length ? <Caption>and {todo.length - shown.length} more</Caption> : null}
      {unread}
    </div>
  );
}
