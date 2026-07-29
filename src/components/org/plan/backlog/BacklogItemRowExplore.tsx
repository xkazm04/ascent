import type { BacklogItem } from "@/lib/db";

/**
 * The row's gap-exploration disclosure — the companion-voice "why this gap matters" (rationale) and the
 * invitational questions to explore it, carried from the recommendation (the same `explore[]` the repo
 * report surfaces). A collapsed native <details> so it never bloats the row's default height. Renders
 * nothing when the scan predates these fields (legacy rows carry an empty rationale + no questions).
 */
export function BacklogRowExplore({ item }: { item: BacklogItem }) {
  if (!item.rationale && item.explore.length === 0) return null;
  return (
    <details className="mt-3 border-t border-slate-800 pt-3">
      <summary className="cursor-pointer font-mono text-sm text-slate-400 transition hover:text-white">
        Why this gap matters
      </summary>
      <div className="mt-2 space-y-2">
        {item.rationale && <p className="text-sm text-slate-400">{item.rationale}</p>}
        {item.explore.length > 0 && (
          <ul className="space-y-1.5">
            {item.explore.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-300">
                <span className="select-none text-accent" aria-hidden>
                  ?
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
