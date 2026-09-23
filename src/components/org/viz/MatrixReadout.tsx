// The one line under a MatrixGrid that says what the pinned cell means, in visible text.
//
// The per-cell sentence (subject, axis, state label, the state's caveat) used to exist only as a
// `title` attribute: hover-only, so a keyboard or touch reader had no route to why a cell is
// hatched. Pinning a cell (tap, click or keyboard focus) prints it here instead. The slot keeps its
// height whether or not anything is pinned, so pinning shifts nothing below the grid.
//
// The live region is polite and atomic: a screen reader hears the caveat after the focused cell's
// own name, without interrupting it. The idle hint sits OUTSIDE the live region, so clearing a pin
// (Escape) is silent rather than re-announcing the instructions.
//
// No hooks and no handlers: this renders inside MatrixGrid's client boundary and needs none itself.

export function MatrixReadout({ text }: { text: string | null }) {
  return (
    <div className="mt-2 min-h-[2.75rem]">
      <p aria-live="polite" aria-atomic="true" className="type-body-sm text-slate-300">
        {text && <span data-readout>{text}</span>}
      </p>
      {!text && (
        <p aria-hidden="true" className="type-micro text-slate-600">
          Select a cell, or use the arrow keys, to read it here.
        </p>
      )}
    </div>
  );
}
