"use client";

// The register's lens switch (card landing-1): an aria-pressed button group. "As scored" is the board as
// each repo was weighted under its own lens; Solo / Team / Org re-weight every live row with the engine's
// lens. Rendered only when the board is a ranking (registerLens `offered`).

import { REGISTER_LENS_OPTIONS, type RegisterLens } from "./registerLensModel";

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
    <div className="rg-lens">
      <div role="group" aria-label="Read the register through a lens" className="seg">
        {REGISTER_LENS_OPTIONS.map((o) => (
          <button key={o.id} type="button" aria-pressed={o.id === lens} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {lens === "as-scored" && lensesOnBoard > 1 && (
        <span>Rows weighted under {lensesOnBoard} lenses, each repo under its own.</span>
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
      className={`rg-move ${up ? "up" : "down"}`}
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
    <div className="note rg-note">
      <p>
        <b>Scores re-weighted in the browser</b> with the engine&apos;s {label} lens weights, over each row&apos;s stored
        dimension scores. Each report keeps the score it was scored under.
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
