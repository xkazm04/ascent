import { scoreGlyph, scoreHex } from "@/lib/ui";
import { LEADER_MAX, ROW_H, type LiveRepo } from "@/components/org/liveWarRoomShared";

export function Leaderboard({ repos, className = "" }: { repos: LiveRepo[]; className?: string }) {
  const shown = repos.slice(0, LEADER_MAX);
  const overflow = Math.max(0, repos.length - LEADER_MAX);
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm uppercase tracking-widest text-accent">Fleet leaderboard</h3>
        <span className="font-mono text-sm text-slate-500">{repos.length} ranked</span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-base text-slate-500">No scans yet — launch the live scan to populate the board.</p>
      ) : (
        <ol className="relative mt-3 list-none" style={{ height: shown.length * ROW_H }}>
          {shown.map((r, i) => {
            const color = scoreHex(r.overall!);
            return (
              <li
                key={r.fullName}
                className="absolute inset-x-0 flex h-10 items-center gap-3 rounded-lg px-2 transition-all duration-500 ease-out motion-reduce:transition-none"
                style={{ top: i * ROW_H }}
              >
                <span className="w-5 shrink-0 text-right font-mono text-sm tabular-nums text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-base text-slate-200" title={r.fullName}>
                  {r.name}
                </span>
                <div className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-slate-800 sm:block">
                  <div
                    className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
                    style={{ width: `${r.overall}%`, backgroundColor: color }}
                  />
                </div>
                <span className="shrink-0 font-mono text-sm" style={{ color }} aria-hidden>
                  {scoreGlyph(r.overall!)}
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-base font-bold tabular-nums" style={{ color }}>
                  {r.overall}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {overflow > 0 && <p className="mt-3 font-mono text-sm text-slate-500">+{overflow} more repos</p>}
    </div>
  );
}
