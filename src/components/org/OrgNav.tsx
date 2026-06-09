"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Persistent tab bar across the org sub-pages (Overview · Repositories · Contributors · Delivery). */
export function OrgNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/org/${slug}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/executive`, label: "Briefing" },
    { href: `${base}/live`, label: "Live" },
    { href: `${base}/repositories`, label: "Repositories" },
    { href: `${base}/segments`, label: "Segments" },
    { href: `${base}/contributors`, label: "Contributors" },
    { href: `${base}/teams`, label: "Teams" },
    { href: `${base}/delivery`, label: "Delivery" },
    { href: `${base}/practices`, label: "Practices" },
    { href: `${base}/plan`, label: "Plan" },
    { href: `${base}/backlog`, label: "Backlog" },
    { href: `${base}/audit`, label: "Audit" },
  ];
  return (
    <div className="relative">
      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-800 text-base">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 font-medium transition ${
              active ? "border-accent text-white" : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      </nav>
      {/* Mobile overflow cue: right-edge fade hinting the tab row scrolls past the viewport
          (it scrolls horizontally but mobile hides the scrollbar). */}
      <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 top-5 w-10 bg-gradient-to-l from-ink to-transparent sm:hidden" />
    </div>
  );
}
