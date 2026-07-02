import Link from "next/link";
import { POSTURE_LABEL } from "@/components/org/ui";
import { reportPermalink, scoreHex } from "@/lib/ui";
import { POSTURE_HEX, POSTURE_ORDER, postureBarPct, type Mover } from "@/components/org/liveWarRoomShared";

export function PostureMix({
  counts,
  scored,
  slug,
  readOnly = false,
}: {
  counts: Record<string, number>;
  scored: number;
  slug: string;
  /** Kiosk/TV view: the repositories link needs a session, so the header stays plain. */
  readOnly?: boolean;
}) {
  // One 100%-stacked band instead of four separate meter rows: the mix reads at a glance and the
  // panel drops two rows of chrome. Segment widths are each posture's TRUE share of the scored
  // fleet (postureBarPct — never max-normalized); the flex gaps let the track show through as the
  // segment separator, and the legend below carries identity + counts so color is never the only channel.
  const shares = POSTURE_ORDER.map((p) => ({
    posture: p,
    n: counts[p] ?? 0,
    pct: postureBarPct(counts[p] ?? 0, scored, counts),
    color: POSTURE_HEX[p] ?? "#64748b",
  }));
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Posture mix</h3>
        {readOnly ? (
          <span className="font-mono text-sm text-slate-500">{scored} scored</span>
        ) : (
          <Link href={`/org/${slug}/repositories`} className="font-mono text-sm text-slate-500 transition hover:text-accent">
            {scored} scored →
          </Link>
        )}
      </div>
      <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-800">
        {shares
          .filter((s) => s.n > 0)
          .map((s) => (
            <div
              key={s.posture}
              className="h-full rounded-sm transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ width: `${s.pct}%`, backgroundColor: s.color }}
              title={`${POSTURE_LABEL[s.posture]}: ${s.n} (${Math.round(s.pct)}%)`}
            />
          ))}
      </div>
      <dl className="mt-3 space-y-1.5">
        {shares.map((s) => {
          const isNative = s.posture === "ai-native";
          return (
            <div key={s.posture} className="flex items-center gap-2 text-base">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
              <dt className={`min-w-0 flex-1 truncate ${isNative ? "font-medium text-white" : "text-slate-300"}`}>
                {POSTURE_LABEL[s.posture]}
              </dt>
              <dd className="font-mono text-sm tabular-nums" style={{ color: s.n > 0 ? s.color : "#64748b" }}>
                {s.n}
                {s.n > 0 && <span className="text-slate-500"> · {Math.round(s.pct)}%</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function MoversTicker({
  ticker,
  running,
  readOnly = false,
}: {
  ticker: Mover[];
  running: boolean;
  /** Kiosk/TV view: report links need a session, so names stay plain text. */
  readOnly?: boolean;
}) {
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
              {/* Each mover jumps to its report — a fresh result begs "what changed?", the report answers. */}
              {readOnly ? (
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200" title={m.fullName}>
                  {m.name}
                </span>
              ) : (
                <Link
                  href={reportPermalink(m.fullName)}
                  title={m.fullName}
                  className="min-w-0 flex-1 truncate font-mono text-sm text-slate-200 underline-offset-2 hover:text-accent hover:underline"
                >
                  {m.name}
                </Link>
              )}
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
