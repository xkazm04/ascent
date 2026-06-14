"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string };
type Group = { label: string; tabs: Tab[] };

/**
 * Persistent tab bar across the org sub-pages. The views are grouped into labeled
 * sections (Overview · Fleet · Intelligence · Plan · Govern) so the bar stays scannable —
 * every tab is still one click; the small muted labels just organize them.
 */
export function OrgNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/org/${slug}`;
  const groups: Group[] = [
    {
      label: "Overview",
      tabs: [
        { href: base, label: "Overview" },
        { href: `${base}/executive`, label: "Briefing" },
      ],
    },
    {
      label: "Fleet",
      tabs: [
        { href: `${base}/repositories`, label: "Repositories" },
        { href: `${base}/segments`, label: "Segments" },
        { href: `${base}/live`, label: "Live" },
      ],
    },
    {
      label: "Intelligence",
      tabs: [
        { href: `${base}/security`, label: "Security" },
        { href: `${base}/adoption`, label: "Adoption" },
        { href: `${base}/delivery`, label: "Delivery" },
        { href: `${base}/contributors`, label: "Contributors" },
        { href: `${base}/teams`, label: "Teams" },
      ],
    },
    {
      label: "Plan",
      tabs: [
        { href: `${base}/practices`, label: "Practices" },
        { href: `${base}/plan`, label: "Plan" },
        { href: `${base}/backlog`, label: "Backlog" },
      ],
    },
    {
      label: "Govern",
      tabs: [
        { href: `${base}/members`, label: "Members" },
        { href: `${base}/governance`, label: "Governance" },
        { href: `${base}/audit`, label: "Audit" },
      ],
    },
  ];

  return (
    <div className="relative">
      <nav className="mt-5 flex items-end overflow-x-auto border-b border-slate-800 text-base">
        {groups.map((g, gi) => (
          <div key={g.label} className="flex items-end">
            {gi > 0 && <div aria-hidden className="mx-1.5 mb-2.5 h-4 w-px self-end bg-slate-800" />}
            <div className="flex flex-col">
              <span className="px-3.5 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                {g.label}
              </span>
              <div className="flex">
                {g.tabs.map((t) => {
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
              </div>
            </div>
          </div>
        ))}
      </nav>
      {/* Mobile overflow cue: right-edge fade hinting the tab row scrolls past the viewport
          (it scrolls horizontally but mobile hides the scrollbar). */}
      <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 top-5 w-10 bg-gradient-to-l from-ink to-transparent sm:hidden" />
    </div>
  );
}
