import type { Celebration } from "@/components/org/shared/liveWarRoomShared";

export function Celebrations({ celebrations }: { celebrations: Celebration[] }) {
  if (celebrations.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2" aria-live="polite">
      {celebrations.map((c) => (
        <div
          key={c.id}
          className="animate-burst relative overflow-hidden rounded-xl border border-success/40 bg-success/10 px-4 py-3 shadow-lg shadow-success/10 backdrop-blur"
        >
          <span aria-hidden className="burst-ring absolute -left-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-success/40" />
          <div className="relative flex items-center gap-3">
            <span className="type-title" aria-hidden>
              🎉
            </span>
            <div>
              <div className="type-mono-sm uppercase tracking-widest text-success-soft">Crossed into AI-Native</div>
              <div className="type-body font-semibold text-white">
                {c.name} {c.overall != null && <span className="font-mono text-success-soft">· {c.overall}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
