"use client";

// Right-edge section dots for a scroll-snap deck: tracks which full-viewport section is centered and
// jumps to any of them. Desktop-only. Pass a STABLE `sections` array (module-level const) so the
// observer isn't torn down every render. Each dot is an anchor → clicking smooth-scrolls + snaps.

import { useEffect, useState } from "react";

export interface DeckSectionRef {
  id: string;
  label: string;
}

export function DeckNav({ sections }: { sections: DeckSectionRef[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px" }, // active once a section crosses the viewport middle
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Page sections" className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
      {sections.map((s) => {
        const on = active === s.id;
        // DECK #1: add the shared .focus-ring so keyboard focus is visible, and reveal the
        // destination label on focus (not just hover) so a focused dot announces where it jumps.
        return (
          <a key={s.id} href={`#${s.id}`} aria-label={s.label} aria-current={on ? "true" : undefined} className="focus-ring group flex items-center justify-end gap-2 rounded-full">
            <span className={`font-mono text-xs uppercase tracking-wider transition ${on ? "text-accent opacity-100" : "text-slate-500 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}>
              {s.label}
            </span>
            <span className={`h-2 w-2 rounded-full border transition ${on ? "border-accent bg-accent" : "border-slate-600 group-hover:border-slate-400"}`} />
          </a>
        );
      })}
    </nav>
  );
}
