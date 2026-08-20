// One column of the erasure manifest — "Erased, permanently" or "Kept, untouched". Pure relocation
// out of DataErasureDialog.tsx so that file stays under the 200-LOC `src/features/**` cap once the
// blast-radius preview was wired into it. Presentational only: no hooks, no handlers, so deliberately
// NO "use client" — adding one would drag this across the server/client boundary for nothing.

const ITEM = "flex gap-2 text-sm leading-relaxed";
const MARK = "mt-px shrink-0 font-mono text-xs";

export function DataErasureColumn({
  kicker,
  tone,
  items,
}: {
  kicker: string;
  tone: "erased" | "kept";
  items: React.ReactNode[];
}) {
  const color = tone === "erased" ? "text-danger" : "text-emerald-300";
  const mark = tone === "erased" ? "✕" : "✓";
  return (
    <div>
      <p className={`font-mono text-xs uppercase tracking-widest ${color}`}>{kicker}</p>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className={ITEM}>
            <span aria-hidden className={`${MARK} ${color}`}>
              {mark}
            </span>
            <span className="text-slate-300">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
