"use client";

// THE DRAG HANDLE on a column's right edge. Pointer events (not mouse events) so a pen or a touch
// drag works the same, with `setPointerCapture` so the pointer can leave the 6px strip mid-drag and
// still be tracked — the classic reason a hand-rolled resizer feels broken.
//
// A drag is DIRECT MANIPULATION, not animation: the column tracks the pointer with no transition, at
// any motion preference. Nothing here is gated under `prefers-reduced-motion` because nothing here
// moves on its own.
//
// Keyboard parity is not optional: the handle is focusable, announces itself as a vertical separator,
// and ←/→ resize it (with Shift for a coarse step). Without that, the widths — and therefore the
// evidence a wide column reveals — would be mouse-only.

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_COLUMN_PX, MIN_COLUMN_PX } from "./useColumnWidths";

const STEP = 16;
const COARSE_STEP = 64;

export function ColumnResizer({ label, width, onResize }: { label: string; width: number; onResize: (px: number) => void }) {
  const from = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    // The handle sits inside a header button's cell; a drag must never read as a click on the run.
    e.preventDefault();
    e.stopPropagation();
    from.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!from.current) return;
    onResize(from.current.width + (e.clientX - from.current.x));
  };

  const release = (e: PointerEvent<HTMLSpanElement>) => {
    if (!from.current) return;
    from.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // The capture is already gone (the element re-rendered mid-drag) — nothing to release.
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.shiftKey ? COARSE_STEP : STEP;
    onResize(width + (e.key === "ArrowLeft" ? -step : step));
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_COLUMN_PX}
      aria-valuemax={MAX_COLUMN_PX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKeyDown}
      className="focus-ring absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize touch-none select-none rounded-sm hover:bg-accent/40"
    />
  );
}
