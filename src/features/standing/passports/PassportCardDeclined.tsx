// The accepted-gap list on the PassportCard. Co-located with the card (200-LOC cap under
// src/features/**); no "use client" — no hooks, no handlers, so it renders on the server with the card.
//
// The card used to render `blockers` and nothing else. Because the overlay RETIRES an accepted gap from
// `blockers` and re-emits it under `passport.declined`, that made every accepted gap invisible on the
// card: "the owner knowingly runs this without error tracking" and "this repo has error tracking" drew
// exactly the same scorecard. An accepted gap is still a gap; only the judgment differs.
//
// Re-confirmation is rendered the way the fleet DeclinedList renders it, deliberately: a decline the
// overlay has re-surfaced (its finding changed kind, hardened, or aged past the window) is OPEN, and
// its blocker is still in the list above. Showing it as settled on the report while the fleet table
// shows it as open is how two surfaces of the same product start disagreeing about the same repo.

import type { DeclinedByChoice } from "@/lib/types";

export function PassportCardDeclined({ declined }: { declined?: DeclinedByChoice[] }) {
  if (!declined?.length) return null;
  const stale = declined.filter((d) => d.needsReconfirm).length;
  return (
    <div className="mt-4" data-testid="passport-card-declined">
      <div className="type-mono-sm uppercase tracking-widest text-slate-500">
        Accepted by choice
        {stale > 0 && <span className="ml-2 text-amber-400">{stale} need re-confirmation</span>}
      </div>
      <ul className="mt-1.5 space-y-1.5 type-body-sm">
        {declined.map((d) => (
          <li key={d.path} className="flex gap-2">
            <span aria-hidden className={`mt-0.5 select-none ${d.needsReconfirm ? "text-amber-400" : "text-slate-600"}`}>
              {d.needsReconfirm ? "!" : "◇"}
            </span>
            <span className="min-w-0">
              <span className="text-slate-400">{d.label}</span>
              {/* A decision record with no author is an assertion nobody owns — say "unknown" rather
                  than quietly dropping the attribution. */}
              <span className="type-caption text-slate-600">
                {" "}· declined by {d.by ?? "unknown"}
                {d.at ? ` on ${d.at}` : ""}
              </span>
              {d.needsReconfirm && (
                <span className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 font-mono type-micro uppercase tracking-widest text-amber-400">
                  needs re-confirmation
                </span>
              )}
              {d.blocker && <span className="mt-0.5 block text-slate-500">{d.blocker}</span>}
              {d.reason && <span className="mt-0.5 block italic text-slate-500">&ldquo;{d.reason}&rdquo;</span>}
              {d.needsReconfirm && (
                <span className="mt-1 block text-amber-400/90">
                  {d.reconfirmReason} It is listed as an open blocker above until it is re-confirmed.
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
