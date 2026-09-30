// RepoRow: THE repository row of the fleet views (Repositories, Passports, Security). One ruled row, five roles:
// name (sans, the named object, a link when the repo has a stored report), stack (what the repo is), score (level
// word + figure, or a VoidMark when nothing was measured: never a 0), movement (a signed delta with its basis) and
// chips (status/honesty tags). `cells` carries the module's own measures and `actions` its controls, so the part
// fixes the identity and rhythm of a repo row without owning any module's columns. Sits in a HairlineList; server-safe.
import type { ReactNode } from "react";
import Link from "next/link";
import { VoidMark } from "./VoidMark";

export function RepoRow({
  name,
  href,
  title,
  stack,
  level,
  score,
  scoreLabel,
  movement,
  chips,
  leading,
  cells,
  actions,
  className = "",
}: {
  /** The repo's full name (owner/name). */
  name: string;
  /** Present when a stored report exists; absent renders the name inert. */
  href?: string;
  title?: string;
  /** Detected stack badges. */
  stack?: ReactNode;
  /** Maturity level id ("L5"): a word, never a status colour. */
  level?: string | null;
  /** Overall 0..100; null or undefined means unmeasured and draws the void mark. */
  score?: number | null;
  scoreLabel?: string;
  /** A <Movement/>: the score's change with its basis. */
  movement?: ReactNode;
  /** Status and honesty chips (scan failed, conformance, queued). */
  chips?: ReactNode;
  /** A selection checkbox or rank. */
  leading?: ReactNode;
  cells?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const nameCls = "block min-w-0 truncate text-[1.0625rem] font-semibold leading-tight tracking-[-0.01em]";
  return (
    <li
      data-kit="repo-row"
      data-role="repo-row"
      className={`grid items-center gap-x-6 gap-y-3 py-4 ${leading ? "lg:grid-cols-[1.5rem_minmax(0,1.4fr)_5rem_minmax(0,2.4fr)_auto]" : "lg:grid-cols-[minmax(0,1.4fr)_5rem_minmax(0,2.4fr)_auto]"} ${className}`.trim()}
    >
      {leading && (
        <div data-role="repo-row-leading" className="flex items-center">
          {leading}
        </div>
      )}
      <div className="min-w-0">
        {href ? (
          <Link data-role="repo-row-name" href={href} title={title ?? `View ${name}'s latest report`} className={`${nameCls} focus-ring text-white hover:text-accent`}>
            {name}
          </Link>
        ) : (
          <span data-role="repo-row-name" title={title ?? `${name} (not scanned yet)`} className={`${nameCls} text-slate-300`}>
            {name}
          </span>
        )}
        {stack && (
          <div data-role="repo-row-stack" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 type-caption text-slate-400">
            {stack}
          </div>
        )}
        {chips && (
          <div data-role="repo-row-chips" className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {chips}
          </div>
        )}
      </div>
      <div data-role="repo-row-score" className="flex items-baseline gap-2 lg:flex-col lg:items-start lg:gap-0.5">
        {score == null ? (
          <VoidMark subject={scoreLabel ?? "Overall score"} />
        ) : (
          <>
            <span data-role="repo-row-figure" title={scoreLabel} className="text-[1.75rem] font-light leading-none tabular-nums text-white">
              {score}
            </span>
            {level && <span className="type-caption text-slate-400">{level}</span>}
          </>
        )}
        {movement && (
          <span data-role="repo-row-movement" className="type-caption">
            {movement}
          </span>
        )}
      </div>
      <div data-role="repo-row-cells" className="flex min-w-0 flex-wrap gap-x-8 gap-y-2">
        {cells}
      </div>
      <div data-role="repo-row-actions" className="flex flex-wrap items-center gap-2 lg:justify-end">
        {actions}
      </div>
    </li>
  );
}

/** One labelled measure inside a RepoRow's `cells`. */
export function RepoRowCell({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div data-role="repo-row-cell" title={title} className="min-w-[4.5rem] whitespace-nowrap">
      <div className="type-caption text-slate-400">{label}</div>
      <div className="mt-0.5 text-[0.9375rem] tabular-nums text-slate-200">{children}</div>
    </div>
  );
}
