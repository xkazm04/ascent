// DataTable — the kit's table shell: scroll wrapper, hairline frame, muted mono head, divided rows and
// a subtle row hover. Pass the header row as `head` and body rows as children. Cell class constants are
// exported so every table aligns its cells the same way. `maxHeight` scrolls the body and pins the head.
// Opt-in props (all inert when unset, so a table that does not ask renders exactly as before):
//   density      "compact" = ~32px rows for ledgers read as a whole.
//   foot         a `<tfoot>` row (fleet average, totals), ruled off from the body.
//   stickyHead   "scroll" pins the head inside the `maxHeight` scroller; "page" pins it under the app header
//                while the PAGE scrolls (from lg up; below that the wrapper scrolls sideways instead).
//   stickyFirstCol  the row-head cell (first column) stays put while a wide table scrolls sideways.
//   variant      "sheet" = a grid of runs: cell left rules are transparent except at `data-run-start` cells.
//                "plain" = the caller draws its own frame, row rules and padding (a table inside a panel, a matrix
//                with its own cells); the kit still supplies the head type and tabular figures in Prism.
//   size         "sm" = the 15px table (`type-body-sm`) instead of the 17px default; a plain table sets none.
//   labelledBy   makes the scroll wrapper a focusable, named region (keyboard access to a wide table).
//   headClassName  extra classes for the `<thead>` (e.g. a solid fill under a sticky head).
export const CELL = "px-4 py-3";
export const CELL_NUM = "px-4 py-3 text-right tabular-nums";
export const HEAD_CELL = "px-4 py-3 text-left font-normal";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ") || undefined;

export function DataTable({
  head,
  children,
  minWidth = 640,
  caption,
  maxHeight,
  className = "",
  density = "comfortable",
  foot,
  stickyHead,
  stickyFirstCol = false,
  variant,
  size,
  headClassName = "",
  tableClassName = "w-full",
  labelledBy,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: number;
  /** Accessible name (visually hidden). */
  caption?: string;
  /** CSS length such as "28rem": scroll the body and keep the head pinned. */
  maxHeight?: string;
  className?: string;
  density?: "comfortable" | "compact";
  /** Footer rows (`<tr>`), rendered in a `<tfoot>`. */
  foot?: React.ReactNode;
  /** `scroll` (default when `maxHeight` is set) or `page` (under the app header, page scroll). */
  stickyHead?: "scroll" | "page";
  stickyFirstCol?: boolean;
  variant?: "sheet" | "plain";
  size?: "md" | "sm";
  headClassName?: string;
  /** Classes for the `<table>` itself; the default is `w-full` (pass "" to size to the content). */
  tableClassName?: string;
  /** Id of the heading that names this table. A wide table that scrolls sideways has no focusable child, so a
   *  keyboard user could never reach its far columns: passing this makes the wrapper a focusable, named region
   *  (WCAG 2.1.1). */
  labelledBy?: string;
}) {
  const sticky = stickyHead ?? (maxHeight ? "scroll" : undefined);
  // Page-sticky needs a wrapper that is not a scroll container; sideways scroll survives below lg.
  const wrap = sticky === "page" ? "overflow-x-auto lg:overflow-visible" : "overflow-x-auto";
  const plain = variant === "plain";
  // A plain table inherits its type from the surface it sits in unless the caller names a size.
  const sizeClass = size === "sm" ? "type-body-sm" : size === "md" || (!size && !plain) ? "type-body" : "";
  return (
    <div
      data-kit="data-table"
      data-role="data-table"
      data-density={density}
      data-sticky={sticky}
      data-sticky-first-col={stickyFirstCol || undefined}
      data-variant={variant}
      {...(labelledBy ? { role: "region", tabIndex: 0, "aria-labelledby": labelledBy } : {})}
      className={cx(wrap, labelledBy && "focus-ring", !plain && "rounded-2xl border border-divider", className)}
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <table className={cx(tableClassName, sizeClass)} style={{ minWidth: `${minWidth}px` }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead
          data-role="data-table-head"
          className={cx(!plain && "bg-surface/60 type-label tracking-[0.2em] text-slate-500", sticky === "scroll" && "sticky top-0 z-10", headClassName)}
        >
          {head}
        </thead>
        <tbody className={plain ? undefined : "divide-y divide-divider [&>tr]:transition-colors [&>tr:hover]:bg-surface/40"}>{children}</tbody>
        {foot ? (
          <tfoot data-role="data-table-foot" className="border-t border-divider">
            {foot}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
