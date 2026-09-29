// DataTable — the kit's table shell: scroll wrapper, hairline frame, muted mono head, divided rows and
// a subtle row hover. Pass the header row as `head` and body rows as children. Cell class constants are
// exported so every table aligns its cells the same way. `maxHeight` scrolls the body and pins the head.
export const CELL = "px-4 py-3";
export const CELL_NUM = "px-4 py-3 text-right tabular-nums";
export const HEAD_CELL = "px-4 py-3 text-left font-normal";

export function DataTable({
  head,
  children,
  minWidth = 640,
  caption,
  maxHeight,
  className = "",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
  /** Accessible name (visually hidden). */
  caption?: string;
  /** CSS length such as "28rem": scroll the body and keep the head pinned. */
  maxHeight?: string;
  className?: string;
}) {
  return (
    <div
      data-kit="data-table"
      data-role="data-table"
      className={`overflow-x-auto rounded-2xl border border-divider ${className}`}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <table className="w-full type-body" style={{ minWidth: `${minWidth}px` }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead data-role="data-table-head" className={`bg-surface/60 type-label tracking-[0.2em] text-slate-500 ${maxHeight ? "sticky top-0 z-10" : ""}`}>
          {head}
        </thead>
        <tbody className="divide-y divide-divider [&>tr]:transition-colors [&>tr:hover]:bg-surface/40">{children}</tbody>
      </table>
    </div>
  );
}
