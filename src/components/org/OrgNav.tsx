"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Persistent tab bar across the org sub-pages (Overview · Repositories · Contributors · Delivery). */
export function OrgNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/org/${slug}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/repositories`, label: "Repositories" },
    { href: `${base}/contributors`, label: "Contributors" },
    { href: `${base}/delivery`, label: "Delivery" },
    { href: `${base}/practices`, label: "Practices" },
    { href: `${base}/audit`, label: "Audit" },
  ];
  return (
    <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-800 text-sm">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 font-medium transition ${
              active ? "border-accent text-white" : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
