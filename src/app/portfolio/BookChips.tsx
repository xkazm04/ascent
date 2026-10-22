// The book as one-click toggles: every company the viewer can read (already re-gated by the page) is a
// plain link that adds it to or drops it from the book. No "use client": links work without JS and the
// URL stays shareable.

import Link from "next/link";
import { bookToggleHref } from "@/lib/org/portfolioBookModel";

export function BookChips({ book, choices }: { book: string[]; choices: string[] }) {
  if (choices.length === 0) return null;
  return (
    <nav aria-label="Companies in this book" className="mt-6">
      <p className="type-caption uppercase tracking-[0.2em] text-slate-500" data-portfolio-copy>
        Your book: click a company to drop it or add it back
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {choices.map((org) => {
          const included = book.includes(org);
          return (
            <li key={org}>
              <Link
                href={bookToggleHref(book, org)}
                data-included={included ? "true" : "false"}
                aria-label={`${included ? "Drop" : "Add"} ${org}`}
                className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono type-body-sm transition ${
                  included
                    ? "border-accent/60 bg-accent/10 text-white hover:bg-accent/20"
                    : "border-slate-700 text-slate-500 line-through hover:text-slate-300"
                }`}
              >
                <span aria-hidden="true">{included ? "✓" : "+"}</span>
                {org}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
