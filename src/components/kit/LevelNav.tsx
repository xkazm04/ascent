// LevelNav: the chrome of one level in a nested surface (overview > item scene > evidence). Breadcrumb trail,
// a Back link one level up, and prev/next among siblings. Links only, so it is server-safe and every level has
// a real URL (the landing uses hashes: `#/line/D3/2`; a dashboard may use a query param). The Esc key is the
// client half: mount `<EscBack href=... />` (LevelNav.client.tsx) beside it.
import Link from "next/link";

export type Crumb = { label: string; href?: string };
/** A level link is a real URL (`href`) or, for a level held in a hash on the SAME page, a handler (`onClick`): a button never scrolls. */
export type LevelLink = { label: string; href?: string; onClick?: () => void };

const BTN = "focus-ring inline-flex items-center gap-2 rounded-[3px] border border-divider px-3 py-1.5 type-body-sm font-semibold text-slate-200 hover:border-slate-400 hover:text-white";

function LevelControl({ link, role, className, children, ...rest }: { link: LevelLink; role: string; className: string; children: React.ReactNode; "aria-label"?: string }) {
  if (link.onClick) {
    return (
      <button type="button" onClick={link.onClick} data-role={role} className={className} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <Link href={link.href ?? "#"} data-role={role} className={className} {...rest}>
      {children}
    </Link>
  );
}

export function LevelNav({
  trail,
  back,
  prev,
  next,
  className = "",
}: {
  /** Ancestors first, the current level last (no href = current). */
  trail: readonly Crumb[];
  /** One level up. Omitted at the top level. */
  back?: LevelLink;
  prev?: LevelLink;
  next?: LevelLink;
  className?: string;
}) {
  return (
    <nav aria-label="Level" data-kit="level-nav" data-role="level-nav" className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}>
      {back && (
        <LevelControl link={back} role="level-back" className={BTN}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M14 8H3M7 4L3 8l4 4" />
          </svg>
          {back.label}
        </LevelControl>
      )}
      <ol data-role="level-crumbs" className="m-0 flex list-none flex-wrap items-center gap-2 p-0 type-body-sm text-slate-400">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={i > 0 ? "before:mr-2 before:text-slate-500 before:content-['/']" : ""}>
              {c.href && !last ? (
                <Link href={c.href} className="focus-ring rounded-sm no-underline hover:text-white">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-white" : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {(prev || next) && (
        <span className="ml-auto flex items-center gap-2">
          {prev && (
            <LevelControl link={prev} role="level-prev" className={BTN} aria-label={`Previous: ${prev.label}`}>
              &larr; {prev.label}
            </LevelControl>
          )}
          {next && (
            <LevelControl link={next} role="level-next" className={BTN} aria-label={`Next: ${next.label}`}>
              {next.label} &rarr;
            </LevelControl>
          )}
        </span>
      )}
    </nav>
  );
}
