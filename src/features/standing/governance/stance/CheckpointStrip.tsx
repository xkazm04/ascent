// The perimeter checkpoint (W3, real data) — extracted from perimeterParts.tsx so every file stays
// under the 200-LOC cap (AGENTS.md). Server-safe. Declared-vs-observed only: the "undeclared" column
// is PR attribution the stance never permitted, reported and never enforced.

import type { AiStance } from "@/lib/types";
import type { UndeclaredTool } from "@/lib/org/stance-overview";

/** The checkpoint: what the stance permits to cross into org code, and what was OBSERVED crossing
 *  anyway (PR attribution) without being declared. */
export function CheckpointStrip({ stance, undeclared }: { stance: AiStance; undeclared: UndeclaredTool[] }) {
  const cols: { key: string; title: string; hex: string; copy: string; items: { label: string; note?: string }[] }[] = [
    {
      key: "tools",
      title: "permitted tools",
      hex: "#10b981",
      copy: "Agents and assistants approved for org code.",
      items: stance.permittedTools.map((t) => ({ label: t })),
    },
    {
      key: "models",
      title: "permitted models",
      hex: "#10b981",
      copy: "Model families approved to touch org code.",
      items: stance.permittedModels.map((m) => ({ label: m })),
    },
    {
      key: "undeclared",
      title: "observed · undeclared",
      hex: undeclared.length ? "#ef4444" : "#16a34a",
      copy: "Tools seen in PR attribution that the stance never permitted: declared vs observed, not enforced.",
      items: undeclared.map((u) => ({ label: u.name, note: `${u.repos.length} repo${u.repos.length === 1 ? "" : "s"}` })),
    },
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider lg:grid-cols-3">
      {cols.map((col) => (
        <div key={col.key} className="bg-ink p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: col.hex }}>
              {col.title}
            </span>
            <span className="font-mono text-lg tabular-nums" style={{ color: col.hex }}>
              {col.items.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{col.copy}</p>
          <ul className="mt-3 space-y-1.5">
            {col.items.map((it) => (
              <li key={it.label} className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-slate-100">{it.label}</span>
                {it.note && <span className="font-mono text-xs tabular-nums text-slate-600">{it.note}</span>}
              </li>
            ))}
            {col.items.length === 0 && (
              <li className="text-sm text-slate-600">{col.key === "undeclared" ? "Nothing undeclared observed." : "None declared."}</li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
