// A "?" disclosure that sits beside a section title and holds the explanation that used to run as a
// paragraph under it. Native <details> — no hooks, no state, so a SERVER panel can render it (adding
// "use client" here would drag its host across the boundary for a tooltip, which is the wrong trade).
//
// Why a disclosure and not an intro paragraph: a dense diagnostic board is read many times and
// explained once. A four-line intro is the right thing to have and the wrong thing to make every
// visit scroll past, so it moves behind an affordance that is one click away and always in the same
// place — next to the heading it explains.
//
// The panel is absolutely positioned so opening it never reflows the board underneath (the whole
// point: the rows must not jump when someone reaches for the explanation).

export function SectionHelp({
  label,
  children,
}: {
  /** Accessible name for the toggle — say which section it explains, since "?" alone says nothing. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group relative shrink-0">
      <summary
        aria-label={label}
        title={label}
        className="focus-ring flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full border border-divider font-mono text-xs leading-none text-slate-500 transition hover:border-accent hover:text-accent group-open:border-accent group-open:text-accent [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden>?</span>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-2 w-[34rem] max-w-[calc(100vw-4rem)] rounded-xl border border-divider bg-surface-strong p-3.5 text-sm text-slate-400 shadow-2xl">
        {children}
      </div>
    </details>
  );
}
