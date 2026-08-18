// Horizontal 2-tab switcher for the consolidated Fleet page — Repositories (default) and Segments are
// one component (RepositoriesTab), toggled by the `?tab=` query rather than separate pages. Each tab
// is an App-Router <Link>, so switching is an instant client navigation that re-runs the active tab's
// server render. Pill styling matches the Fleet "Group" switcher in RepoCategoryRollup so they read as
// one system. `active` is resolved by the host page from its searchParams (no client hooks needed).

import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";

export function FleetTabs({ slug, active }: { slug: string; active: "repositories" | "segments" }) {
  const tabs: { key: "repositories" | "segments"; href: string; label: string }[] = [
    { key: "repositories", href: orgTabHref(slug, "repositories"), label: "Repositories" },
    { key: "segments", href: orgTabHref(slug, "segments"), label: "Segments" },
  ];
  return (
    <div role="tablist" aria-label="Fleet view" className="flex items-center gap-1.5">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            className={`focus-ring rounded-full border px-3 py-1 font-mono text-sm transition ${
              isActive ? "border-accent/60 text-white" : "border-divider text-slate-400 hover:border-accent hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
