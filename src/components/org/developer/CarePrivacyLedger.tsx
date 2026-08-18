"use client";

// The privacy ledger + setup block. This is the tab's load-bearing trust surface, so it is shared
// verbatim by all three variants and only its frame changes:
//   `list`   — an editorial two-column ledger of on/off rows (Companion).
//   `switch` — a switch panel: each row a physical-looking state cell (Cockpit).
//
// The rows that are permanently OFF (transcript text, prompts/diffs, per-person org rows) are stated
// explicitly rather than omitted: silence about them reads as "maybe", which is exactly the doubt that
// stops a developer running the mentor at all.

import { SectionEmpty } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import { CareAction, CarePrivacyNote } from "./CareBits";
import type { DeveloperView } from "@/lib/org/developer-view";

function StateMark({ shared, locked }: { shared: boolean; locked: boolean }) {
  if (locked) {
    return <span className="font-mono text-xs uppercase tracking-widest text-slate-500">never</span>;
  }
  return shared ? (
    <span className="font-mono text-xs uppercase tracking-widest text-success-soft">shared</span>
  ) : (
    <span className="font-mono text-xs uppercase tracking-widest text-slate-600">off</span>
  );
}

export function CareSetupStrip({ setup }: { setup: DeveloperView["setup"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="font-mono text-sm tabular-nums text-slate-400">
        mentor{" "}
        <span className={setup.mentorInstalled ? "text-success-soft" : "text-slate-600"}>
          {setup.mentorInstalled ? "installed" : "not installed"}
        </span>
      </span>
      <span className="font-mono text-sm tabular-nums text-slate-400">
        retro hook{" "}
        <span className={setup.hookInstalled ? "text-success-soft" : "text-slate-600"}>
          {setup.hookInstalled ? "on" : "off"}
        </span>
      </span>
      <span className="font-mono text-sm tabular-nums text-slate-400">
        last share <span className="text-slate-300">{setup.lastShareAt ? timeAgo(setup.lastShareAt) : "never"}</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {setup.mentorInstalled ? (
          <CareAction label="Share again" intent="mentor.share" />
        ) : (
          <CareAction label="Install the mentor" intent="mentor.install" />
        )}
        <CareAction label="Copy npx ascent mentor init" intent="mentor.copyCommand" payload={{ cmd: "npx ascent mentor init" }} />
      </div>
    </div>
  );
}

export function CarePrivacyLedger({
  setup,
  layout = "list",
}: {
  setup: DeveloperView["setup"];
  layout?: "list" | "switch";
}) {
  if (setup.sharing.length === 0) {
    return <SectionEmpty>Nothing is shared, because the mentor has never run here.</SectionEmpty>;
  }
  const locked = (note?: string) => Boolean(note && /never/i.test(note));

  if (layout === "switch") {
    return (
      <div className="mt-3">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider sm:grid-cols-2">
          {setup.sharing.map((row) => (
            <div key={row.field} className="flex items-start justify-between gap-3 bg-ink px-4 py-3">
              <div className="min-w-0">
                <div className="text-base text-slate-200">{row.field}</div>
                {row.note ? <div className="text-sm text-slate-500">{row.note}</div> : null}
              </div>
              <div className="shrink-0 pt-1">
                <StateMark shared={row.shared} locked={locked(row.note)} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <CarePrivacyNote />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <dl className="divide-y divide-divider border-y border-divider">
        {setup.sharing.map((row) => (
          <div key={row.field} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="text-base text-slate-200">
              {row.field}
              {row.note ? <span className="text-sm text-slate-500"> — {row.note}</span> : null}
            </dt>
            <dd className="shrink-0">
              <StateMark shared={row.shared} locked={locked(row.note)} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <CarePrivacyNote />
      </div>
    </div>
  );
}
