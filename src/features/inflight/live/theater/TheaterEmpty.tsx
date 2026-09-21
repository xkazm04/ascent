"use client";

// THE ONE EMPTY STATE — what the theater says when there is no runner and the day is still blank.
//
// Every part of this page answers its own question, which is right while something is happening and
// wrong when nothing is: with no runner the header said "No runner", NOW said "Nothing running",
// TODAY said "0 · 0 · $0.00", NEEDS YOU said "Nothing waiting", the hero said "No runner is
// reporting" and the rail said "Nothing yet today" — one sentence, six times, on a screen built so a
// glance lands on one thing. So the shell takes the answer back: the header blocks go blank, the rail
// stands down, and this says it once, in the middle, with the way out.
//
// The way out is a LINK, not a sentence about one. A screen on a third monitor is usually someone
// else's browser, and "start it from the Live tab" leaves them hunting for a tab they may not know;
// the link lands on the cockpit that starts it. The kiosk has no link — its viewer cannot open the
// org — so it gets the sentence alone, which is the honest version for a token that may not
// authenticate anyone.

import Link from "next/link";

export function TheaterEmpty({ slug, href }: { slug: string; href: string | null }) {
  return (
    <section
      aria-label="No runner"
      data-theater-empty
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-[6vh] text-center"
    >
      <p className="type-display font-semibold leading-tight text-slate-300">No runner is reporting</p>
      <p className="max-w-[46ch] type-title text-slate-400">
        Nothing has run for <span className="font-mono text-slate-300">{slug}</span> today, and no standing runner is armed.
      </p>
      {href ? (
        <Link
          href={href}
          className="focus-ring rounded-lg border border-accent/40 bg-accent/10 px-5 py-2.5 type-title font-semibold text-accent transition hover:border-accent hover:bg-accent/20"
        >
          Start one from the Live tab
        </Link>
      ) : (
        <p className="type-body text-slate-500">A standing runner is started from the organization&apos;s Live tab.</p>
      )}
    </section>
  );
}
