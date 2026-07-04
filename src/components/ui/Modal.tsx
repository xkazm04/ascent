"use client";

// The brand dialog ("The Index" voice for interruptions): an ink-veil backdrop over the whole app, a
// surface-strong panel with hairline-ruled sections, and the standard dialog contract done once —
// portal into the root ModalRoot, focus trap + initial focus + focus restore, Escape / backdrop-click
// close, body scroll lock, and a gated entrance beat (animate-fade-in/-up, both reduced-motion-safe).
// `locked` pins the dialog open while an operation is in flight (Escape, backdrop and the header ✕
// all refuse), so a half-finished batch is read, not dismissed. Compose with ModalHeader (Kicker
// eyebrow + title + context + wired close button), ModalBody, and ModalFooter.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Kicker } from "./Kicker";
import { MODAL_ROOT_ID } from "./ModalRoot";

export type ModalSize = "md" | "lg" | "xl";
const SIZE: Record<ModalSize, string> = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

// Header/footer read close-wiring from context so callers don't thread onClose/locked twice.
const ModalCtx = createContext<{ onClose: () => void; locked: boolean }>({ onClose: () => {}, locked: false });

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  ariaLabel,
  size = "lg",
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible dialog name (there may be no visible title yet when the body is a form). */
  ariaLabel: string;
  size?: ModalSize;
  /** An operation is in flight — Escape / backdrop / ✕ refuse to close. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Latest close/locked in a ref so the open-effect binds its listeners once per open.
  const stateRef = useRef({ onClose, locked });
  stateRef.current = { onClose, locked };

  useEffect(() => setMounted(true), []);

  // While open: trap Tab inside the panel, close on Escape (unless locked), lock body scroll, and
  // hand focus back to the opener on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!stateRef.current.locked) stateRef.current.onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || !mounted) return null;
  const host = document.getElementById(MODAL_ROOT_ID) ?? document.body;

  return createPortal(
    <ModalCtx.Provider value={{ onClose, locked }}>
      <div
        className="animate-fade-in fixed inset-0 z-50 flex overflow-y-auto bg-ink/80 p-4 sm:p-8"
        onClick={() => !locked && onClose()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className={`animate-fade-up m-auto w-full ${SIZE[size]} rounded-2xl border border-divider bg-surface-strong shadow-2xl outline-none`}
        >
          {children}
        </div>
      </div>
    </ModalCtx.Provider>,
    host,
  );
}

/** Editorial dialog masthead: Kicker eyebrow + title + optional mono context, with the close button
 *  wired to the Modal's onClose/locked automatically. */
export function ModalHeader({ kicker, title, context }: { kicker?: string; title: string; context?: string }) {
  const { onClose, locked } = useContext(ModalCtx);
  return (
    <div className="flex items-start justify-between gap-4 border-b border-divider px-6 py-4">
      <div className="min-w-0">
        {kicker && <Kicker tone="muted">{kicker}</Kicker>}
        <h2 className={`${kicker ? "mt-1 " : ""}text-lg font-semibold text-white`}>{title}</h2>
        {context && <p className="mt-0.5 font-mono text-sm text-slate-400">{context}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={locked}
        aria-label="Close"
        className="focus-ring shrink-0 rounded-md border border-slate-700 px-2 py-1 text-slate-400 transition hover:border-accent hover:text-white disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  );
}

export function ModalBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}

/** Hairline-topped action row — put the primary action right, a note or secondary action left. */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-6 py-4">{children}</div>;
}
