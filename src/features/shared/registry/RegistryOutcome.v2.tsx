// The last registry call, said next to the control that made it. Glyph plus word, never a status hue.
// Outbound links repeat the ghost action hook because PrimaryAction and GhostAction do not forward target.

import type { RegistryMutation } from "./useRegistryMutation";

const GHOST =
  "focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-divider px-4 py-2 type-body-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-white";

export function RegistryOutbound({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      data-kit="action"
      data-kind="ghost"
      data-role="action-ghost"
      className={GHOST}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

export function RegistryOutcome({ m, action }: { m: RegistryMutation; action?: string }) {
  const err = m.error && (!action || m.error.action === action) ? m.error : null;
  const ok = m.outcome && (!action || m.outcome.action === action) ? m.outcome : null;
  if (err) {
    return (
      <p className="type-body-sm text-slate-100" role="alert">
        <span aria-hidden>! </span>
        {err.message}
      </p>
    );
  }
  if (!ok) return null;
  return (
    <p className="type-body-sm text-slate-300" role="status">
      {ok.message}
      {ok.href ? (
        <>
          {" "}
          <a href={ok.href} className="text-slate-200 underline" target="_blank" rel="noreferrer">
            {ok.hrefLabel ?? "open"}
          </a>
        </>
      ) : null}
    </p>
  );
}
