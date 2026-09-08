"use client";

// One toast, keyed by its identity (never its slot): tone from the severity table, the ONE action named
// by its verb, a dismiss that is a separate target, a dwell bar the entry's own remaining time drives,
// and attention — pointer OR focus within — pausing that clock. Escape dismisses and hands focus back to
// where the user was; Enter on the action is the fast path to the same handler the ledger uses.
// framer-motion here only: entrance/exit keyed by id; under `reduced` opacity alone, no travel.

import { motion } from "framer-motion";
import type { FocusEvent, KeyboardEvent } from "react";
import { type Toast } from "./queue";
import { slotsFor } from "./severity";

export function ToastCard({
  toast,
  reduced,
  onAct,
  onDismiss,
  onAttend,
  onEscape,
}: {
  toast: Toast;
  reduced: boolean;
  onAct: () => void;
  onDismiss: () => void;
  onAttend: (on: boolean) => void;
  onEscape: () => void;
}) {
  const slots = slotsFor(toast.severity);
  const pct = toast.dwellMs && toast.remainingMs !== null ? Math.round((toast.remainingMs / toast.dwellMs) * 100) : null;
  const blur = (e: FocusEvent<HTMLLIElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onAttend(false);
  };
  const key = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
    }
  };
  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: reduced ? 0.01 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-lg border p-2.5 ${slots.border} ${slots.bg}`}
      data-toast={toast.id}
      data-key={toast.key}
      data-severity={toast.severity}
      data-count={toast.count}
      data-attended={toast.attended}
      data-obligation={toast.actionRequired}
      onPointerEnter={() => onAttend(true)}
      onPointerLeave={() => onAttend(false)}
      onFocus={() => onAttend(true)}
      onBlur={blur}
      onKeyDown={key}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${slots.dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`type-caption ${slots.text}`}>
            {toast.title}
            {toast.count > 1 ? <span className="ml-1 font-mono tabular-nums text-slate-400">×{toast.count}</span> : null}
          </p>
          <p className="type-micro text-slate-500">
            {toast.severity}
            {toast.actionRequired ? " · action required · persists" : pct === null ? " · persists" : ` · dwell ${Math.ceil((toast.remainingMs ?? 0) / 1000)}s`}
            {toast.attended ? " · paused (attended)" : ""}
          </p>
        </div>
        {toast.verb ? (
          <button type="button" className="focus-ring rounded-md border border-accent/60 px-2 py-0.5 type-micro text-accent-soft transition hover:bg-accent/10" onClick={onAct} aria-label={`${toast.verb}: ${toast.title}`}>
            {toast.verb}
          </button>
        ) : null}
        <button type="button" className="focus-ring rounded-md px-1 type-caption text-slate-500 transition hover:text-white" onClick={onDismiss} aria-label={`Dismiss: ${toast.title}`}>
          ✕
        </button>
      </div>
      {pct !== null ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-divider" aria-hidden>
          <span className={`block h-full ${slots.dot}`} style={{ width: `${pct}%`, transition: reduced ? "none" : "width 100ms linear" }} />
        </span>
      ) : null}
    </motion.li>
  );
}
