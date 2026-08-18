// The developer how-to block, shared by all three directions: what a developer with only `git` and a
// text editor types. Deliberately a mono block rather than a marketing panel — the registry's whole
// premise is that ascent is NOT in the write path, so the commands are the product surface here.
//
// Server-safe (no hooks): the copy affordance is a plain `<code>` the user selects. A clipboard button
// would need a client boundary for three lines of text; the round can decide that later.

import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
      <span className="w-28 shrink-0 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <code className="rounded bg-slate-800/70 px-2 py-0.5 font-mono text-sm text-slate-200">{value}</code>
    </div>
  );
}

export function RegistryHowTo({ view, dense = false }: { view: RegistryView; dense?: boolean }) {
  const { syncCmd, hooksCmd, pointer } = view.howTo;
  return (
    <div className={dense ? "" : "space-y-2"}>
      <Kicker tone="muted">Developer how-to</Kicker>
      {!dense && (
        <p className="max-w-2xl text-sm text-slate-400">
          Git is the interface. A developer clones the registry, edits a <code className="font-mono text-slate-300">SKILL.md</code>,
          bumps its version, appends <code className="font-mono text-slate-300">LESSONS.md</code> and opens a PR. Nothing here needs
          an ascent session.
        </p>
      )}
      <div className="mt-1 divide-y divide-divider rounded-xl border border-divider bg-surface-strong/40 px-4 py-2">
        <Line label="sync" value={syncCmd} />
        <Line label="hooks" value={hooksCmd} />
        <Line label="pointer" value={pointer} />
      </div>
      {!dense && (
        <p className="text-xs text-slate-500">
          The pointer lives in each repo&apos;s <code className="font-mono">.ai/manifest.yaml</code>. A repo with no pointer falls back
          to your canonical registry.
        </p>
      )}
    </div>
  );
}
