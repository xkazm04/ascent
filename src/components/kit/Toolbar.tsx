// Toolbar — the row above a view: a readout on the left, controls on the right, wrapping on narrow
// widths. No fill of its own; it sits on the page or inside a Panel.
export function Toolbar({
  left,
  right,
  className = "",
  "data-tour": dataTour,
}: {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  "data-tour"?: string;
}) {
  return (
    <div
      data-kit="toolbar"
      data-role="toolbar"
      data-tour={dataTour}
      className={`flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      {left != null && <div className="min-w-0">{left}</div>}
      {right != null && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** The mono, uppercase, muted readout a Toolbar carries on its left ("Showing · Last 90 days"). */
export function ToolbarReadout({ children }: { children: React.ReactNode }) {
  return (
    <span data-role="toolbar-readout" className="type-mono-sm uppercase tracking-widest text-slate-500">
      {children}
    </span>
  );
}
