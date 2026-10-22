// Horizontal 2-tab switcher for the consolidated Fleet page — Repositories (default) and Segments are
// one component (RepositoriesTab), toggled by the `?tab=` query rather than separate pages. Each tab
// is an App-Router <Link>, so switching is an instant client navigation that re-runs the active tab's
// server render. Pill styling matches the Fleet "Group" switcher in RepoCategoryRollup so they read as
// one system. `active` is resolved by the host page from its searchParams (no client hooks needed).

import { orgTabHref } from "@/lib/org/orgTabs";
import { Segmented } from "@/components/kit";

export function FleetTabs({ slug, active }: { slug: string; active: "repositories" | "segments" }) {
  const tabs: { key: "repositories" | "segments"; href: string; label: string }[] = [
    { key: "repositories", href: orgTabHref(slug, "repositories"), label: "Repositories" },
    { key: "segments", href: orgTabHref(slug, "segments"), label: "Segments" },
  ];
  return <Segmented nav label="Fleet view" variant="soft" value={active} options={tabs.map((t) => ({ key: t.key, href: t.href, label: t.label }))} />;
}
