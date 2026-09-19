// The developer how-to block, shared by all three directions: what a developer with only `git` and a
// text editor types. Deliberately a mono block rather than a marketing panel — the registry's whole
// premise is that ascent is NOT in the write path, so the commands are the product surface here.
//
// Two groups: git-native usage (`report --to-registry`, no token) vs hosted push / sink A events
// (token). The token sentence names sink A and MCP only; it never claims registry usage sync needs
// ASCENT_TOKEN.
//
// Server-safe (no hooks): the copy affordance is a plain `<code>` the user selects. A clipboard button
// would need a client boundary for three lines of text; the round can decide that later.

import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { HOWTO_HOSTED_NOTE, HOWTO_USAGE_NOTE } from "@/lib/org/registry-howto";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
      <span className="w-28 shrink-0 type-label tracking-[0.18em] text-slate-500">{label}</span>
      <code className="rounded bg-slate-800/70 px-2 py-0.5 type-mono-sm text-slate-200">{value}</code>
    </div>
  );
}

const BLOCK = "mt-1 divide-y divide-divider rounded-xl border border-divider bg-surface-strong/40 px-4 py-2";

export function RegistryHowTo({ view, dense = false }: { view: RegistryView; dense?: boolean }) {
  const { reportCmd, hooksCmd, pointer, hostedPushCmd, hostedEventsCmd } = view.howTo;
  return (
    <div className={dense ? "" : "space-y-2"}>
      <Kicker tone="muted">Developer how-to</Kicker>
      {!dense && (
        <p className="max-w-2xl type-body-sm text-slate-400">
          Git is the interface. A developer clones the registry, edits a <code className="font-mono text-slate-300">SKILL.md</code>,
          bumps its version, appends <code className="font-mono text-slate-300">LESSONS.md</code> and opens a PR. Nothing here needs
          an ascent session.
        </p>
      )}
      <div data-howto="git-native" className={BLOCK}>
        <Line label="usage" value={reportCmd} />
        <Line label="hooks" value={hooksCmd} />
        <Line label="pointer" value={pointer} />
      </div>
      {!dense && <p className="type-note text-slate-500">{HOWTO_USAGE_NOTE}</p>}
      {!dense && (
        <>
          <p className="pt-2 type-label tracking-[0.18em] text-slate-500">Hosted push / events</p>
          <div data-howto="hosted" className={BLOCK}>
            <Line label="push" value={hostedPushCmd} />
            <Line label="events" value={hostedEventsCmd} />
          </div>
          <p className="type-note text-slate-500">{HOWTO_HOSTED_NOTE}</p>
        </>
      )}
    </div>
  );
}
