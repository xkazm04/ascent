import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_CLASSES, LEVEL_GLYPH, scoreHex } from "@/lib/ui";

export function LevelLadder({ currentId }: { currentId: string }) {
  return (
    <div className="mt-5 flex gap-1.5">
      {LEVELS.map((l) => {
        const active = l.id === currentId;
        const lc = LEVEL_CLASSES[l.id];
        return (
          <div key={l.id} className="flex-1 text-center">
            <div
              className={`h-1.5 rounded-full ${active ? "" : "bg-slate-800"}`}
              style={active ? { backgroundColor: scoreHex(l.band[0]) } : undefined}
            />
            <div aria-hidden className={`mt-1 text-sm leading-none ${active ? lc.text : "text-slate-500"}`}>
              {LEVEL_GLYPH[l.id]}
            </div>
            <div className={`mt-0.5 text-sm ${active ? lc.text : "text-slate-500"}`}>{l.id}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" }) {
  if (items.length === 0) return null;
  const mark = tone === "good" ? "text-emerald-400" : "text-amber-400";
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-3 space-y-2 text-base text-slate-300">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={mark}>{tone === "good" ? "▲" : "▼"}</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
