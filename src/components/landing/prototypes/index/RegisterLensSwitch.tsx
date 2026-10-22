"use client";

// The register's lens switch (card landing-1): an aria-pressed button group. "As scored" is the board
// as each repo was weighted under its own lens; Solo / Team / Org re-weight every live row with the
// engine's lens. Rendered only when the board is a ranking (registerLens `offered`).

import { REGISTER_LENS_OPTIONS, type RegisterLens } from "../shared/registerLensModel";

export function RegisterLensSwitch({
  lens,
  onChange,
  lensesOnBoard,
}: {
  lens: RegisterLens;
  onChange: (lens: RegisterLens) => void;
  lensesOnBoard: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3">
      <div role="group" aria-label="Read the register through a lens" className="inline-flex rounded-md border border-slate-700 p-0.5">
        {REGISTER_LENS_OPTIONS.map((o) => {
          const on = o.id === lens;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className={`focus-ring rounded px-2.5 py-1 type-label tracking-widest transition ${
                on ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {lens === "as-scored" && lensesOnBoard > 1 && (
        <span className="type-body-sm text-slate-500">
          Rows weighted under {lensesOnBoard} lenses, each repo under its own.
        </span>
      )}
    </div>
  );
}

/** The signed rank move a lens gave a row, or nothing when it held its place. */
export function MoveMarker({ move }: { move: number }) {
  if (move === 0) return null;
  const up = move > 0;
  const n = Math.abs(move);
  return (
    <span
      data-move={move}
      className={`ml-2 font-mono type-micro normal-case tracking-normal ${up ? "text-emerald-300/90" : "text-rose-300/90"}`}
      aria-label={`${up ? "up" : "down"} ${n} ${n === 1 ? "place" : "places"} under this lens`}
    >
      {up ? "▲" : "▼"}
      {n}
    </span>
  );
}

/** Under a lens, what the figures are and which rows sat out. Silent on the as-scored board. */
export function LensNotes({ lens, withheld }: { lens: RegisterLens; withheld: number }) {
  if (lens === "as-scored") return null;
  const label = REGISTER_LENS_OPTIONS.find((o) => o.id === lens)?.label ?? lens;
  return (
    <div className="mt-4 max-w-3xl space-y-1 type-body-sm leading-relaxed text-slate-500">
      <p>
        <span className="text-slate-300">Scores re-weighted in the browser</span> with the engine&apos;s {label}{" "}
        lens weights, over each row&apos;s stored dimension scores. Each report keeps the score it was scored
        under.
      </p>
      {withheld > 0 && (
        <p>
          {withheld} {withheld === 1 ? "row" : "rows"} whose stored score this page could not reproduce{" "}
          {withheld === 1 ? "stays" : "stay"} on the As scored board only.
        </p>
      )}
    </div>
  );
}
