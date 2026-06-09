import type { Celebration } from "@/components/org/liveWarRoomShared";

export function Celebrations({ celebrations }: { celebrations: Celebration[] }) {
  if (celebrations.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2" aria-live="polite">
      {celebrations.map((c) => (
        <div
          key={c.id}
          className="animate-burst relative overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 shadow-lg shadow-emerald-500/10 backdrop-blur"
        >
          <span aria-hidden className="burst-ring absolute -left-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-emerald-400/40" />
          <div className="relative flex items-center gap-3">
            <span className="text-xl" aria-hidden>
              🎉
            </span>
            <div>
              <div className="font-mono text-sm uppercase tracking-widest text-emerald-300">Crossed into AI-Native</div>
              <div className="text-base font-semibold text-white">
                {c.name} {c.overall != null && <span className="font-mono text-emerald-300">· {c.overall}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
