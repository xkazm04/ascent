import Link from "next/link";
import type { ReactNode } from "react";

export interface EmptyStateAction {
  label: string;
  href: string;
  /** Render as the filled accent button (vs the default outline button). At most one per state. */
  primary?: boolean;
}

/**
 * The canonical centered empty/notice state — one icon, a title, body copy, and a row of link
 * actions. Unifies the three hand-rolled variants (report, trends, usage) that had drifted on icon
 * size, primary-button color (a raw hex vs the `text-on-accent` token), and button styling, so the
 * empty states stay visually consistent and a future tweak lands in one place. Server/client safe.
 */
export function EmptyState({
  icon,
  title,
  body,
  actions = [],
}: {
  icon: string;
  title: string;
  body: ReactNode;
  actions?: EmptyStateAction[];
}) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="text-5xl">{icon}</div>
      <h1 className="mt-4 text-2xl font-bold text-white">{title}</h1>
      <p className="mt-2 max-w-md text-slate-400">{body}</p>
      {actions.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {actions.map((a) => (
            <Link
              key={`${a.href}::${a.label}`}
              href={a.href}
              className={
                a.primary
                  ? "rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition hover:bg-accent-soft"
                  : "rounded-xl border border-slate-700 px-5 py-2.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
              }
            >
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
