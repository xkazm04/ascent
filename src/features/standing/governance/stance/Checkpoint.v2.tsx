// What the stance permits, and what was observed crossing anyway. Counts stay paper. An undeclared
// tool is named with a glyph, not painted red.
import { Display, HairlineGrid, VoidMark } from "@/components/kit";
import type { AiStance } from "@/lib/types";
import type { UndeclaredTool } from "@/lib/org/stance-overview";

export function CheckpointV2({ stance, undeclared }: { stance: AiStance; undeclared: UndeclaredTool[] }) {
  const cols: { key: string; title: string; copy: string; items: { label: string; note?: string }[]; empty: string }[] = [
    {
      key: "tools",
      title: "Permitted tools",
      copy: "Agents and assistants approved for org code.",
      items: stance.permittedTools.map((t) => ({ label: t })),
      empty: "None declared.",
    },
    {
      key: "models",
      title: "Permitted models",
      copy: "Model families approved to touch org code.",
      items: stance.permittedModels.map((m) => ({ label: m })),
      empty: "None declared.",
    },
    {
      key: "undeclared",
      title: "Observed, undeclared",
      copy: "Tools seen in PR attribution that the stance never permitted.",
      items: undeclared.map((u) => ({ label: u.name, note: `${u.repos.length} repo${u.repos.length === 1 ? "" : "s"}` })),
      empty: "Nothing undeclared observed.",
    },
  ];
  return (
    <HairlineGrid className="lg:grid-cols-3">
      {cols.map((col) => (
        <div key={col.key} className="bg-ink p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="type-body-sm text-slate-400">{col.title}</span>
            <Display as="div" level="figure">
              {col.key === "undeclared" && col.items.length > 0 && (
                <>
                  <span aria-hidden className="mr-1 align-middle text-[0.45em]">
                    ▲
                  </span>
                  <span className="sr-only">At risk: </span>
                </>
              )}
              {col.items.length}
            </Display>
          </div>
          <p className="mt-1 type-body-sm text-slate-400">{col.copy}</p>
          <ul className="mt-3 space-y-1.5">
            {col.items.map((it) => (
              <li key={it.label} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-slate-200">{it.label}</span>
                {it.note && <span className="type-caption tabular-nums text-slate-400">{it.note}</span>}
              </li>
            ))}
            {col.items.length === 0 && (
              <li className="flex items-center gap-2 type-body-sm text-slate-400">
                {col.key === "undeclared" ? <span aria-hidden>✓</span> : <VoidMark subject={col.title} label="None declared" />}
                {col.empty}
              </li>
            )}
          </ul>
        </div>
      ))}
    </HairlineGrid>
  );
}
