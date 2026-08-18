// The AI tools already in the fleet's PRs — evidence of what's in use, one slim chip band. Extracted
// out of the old page.tsx body (docs/ORG-TABS-REFACTOR.md) into its own named file.

import { Surface, Kicker } from "@/components/ui";

export function AdoptionToolFootprint({ tools }: { tools: { name: string; count: number }[] }) {
  return (
    <Surface radius="xl" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <Kicker tone="muted" className="mr-1">AI tooling in PRs</Kicker>
      {tools.map((t) => (
        <span key={t.name} className="rounded border border-slate-700 px-2 py-0.5 font-mono text-sm text-slate-300">
          {t.name} <span className="text-slate-500">×{t.count}</span>
        </span>
      ))}
      <span className="text-sm text-slate-600">detected via PR co-authorship / body markers</span>
    </Surface>
  );
}
