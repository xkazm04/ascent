import { POSTURE_LABEL, POSTURE_ORDER } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import { POSTURE_HEX, type Mover } from "@/components/org/liveWarRoomShared";

export function PostureMix({ counts, scored }: { counts: Record<string, number>; scored: number }) {
  // Scale each bar to the TOTAL scored fleet, not the largest bucket. Scaling to the max made the
  // LEADING posture always render as a full 100% bar regardless of its real share — on a projected
  // war-room wall that overstates the dominant posture's prevalence to leadership. A true distribution
  // bars each posture as its fraction of the whole.
  const total = Math.max(1, scored, POSTURE_ORDER.reduce((s, p) => s + (counts[p] ?? 0), 0));
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Posture distribution</h3>
      <div className="mt-3 space-y-2.5">
        {POSTURE_ORDER.map((p) => {
          const n = counts[p] ?? 0;
          const color = POSTURE_HEX[p] ?? "#64748b";
          const isNative = p === "ai-native";
          return (
            <div key={p} className="flex items-center gap-3 text-base">
              <span className={`w-32 shrink-0 truncate ${isNative ? "font-medium text-white" : "text-slate-300"}`}>
                {POSTURE_LABEL[p]}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, (n / total) * 100)}%`, backgroundColor: color }}
                />
              </div>
              <span className="w-6 text-right font-mono tabular-nums" style={{ color: n > 0 ? color : "#64748b" }}>
                {n}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 font-mono text-sm text-slate-500">{scored} repo{scored === 1 ? "" : "s"} scored</p>
    </div>
  );
}

export function MoversTicker({ ticker, running }: { ticker: Mover[]; running: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Live movers</h3>
        {running && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
      </div>
      {ticker.length === 0 ? (
        <p className="mt-4 text-base text-slate-500">
          {running ? "Waiting for the first result…" : "Results stream in here as each repo lands."}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {ticker.map((m) => (
            <li key={m.id} className="animate-pop-in flex items-center justify-between gap-3 rounded-md px-1 text-base">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200" title={m.fullName}>
                {m.name}
              </span>
              {m.failed ? (
                <span className="shrink-0 font-mono text-sm text-orange-400">scan failed</span>
              ) : m.skipped ? (
                <span className="shrink-0 font-mono text-sm text-slate-500">skipped · no credits</span>
              ) : (
                <span className="flex shrink-0 items-center gap-2 font-mono text-sm">
                  {m.posture === "ai-native" && <span aria-hidden>🎉</span>}
                  {m.delta != null && m.delta !== 0 && (
                    <span style={{ color: m.delta > 0 ? "#84cc16" : "#f97316" }}>
                      {m.delta > 0 ? "▲" : "▼"}
                      {Math.abs(m.delta)}
                    </span>
                  )}
                  {m.level && <span className="text-slate-500">{m.level}</span>}
                  <span className="font-bold" style={{ color: m.overall != null ? scoreHex(m.overall) : "#fff" }}>
                    {m.overall}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
