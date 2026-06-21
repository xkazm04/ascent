"use client";

import { usePathname } from "next/navigation";
import { SideNav, type SideNavGroup } from "@/components/ui";

/**
 * Persistent section nav across the org sub-pages, rendered as a grouped left rail (SideNav). The
 * views are grouped into labeled sections (Overview · Fleet · Intelligence · Plan · Govern) so the
 * rail stays scannable as the number of sections grows. On small screens SideNav degrades to a
 * horizontal scroller.
 */
export function OrgNav({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/org/${slug}`;
  const def: { label: string; tabs: { href: string; label: string }[] }[] = [
    { label: "Overview", tabs: [
      { href: base, label: "Overview" },
      { href: `${base}/executive`, label: "Briefing" },
    ] },
    { label: "Fleet", tabs: [
      { href: `${base}/repositories`, label: "Repositories" },
      { href: `${base}/segments`, label: "Segments" },
      { href: `${base}/live`, label: "Live" },
    ] },
    { label: "Intelligence", tabs: [
      { href: `${base}/security`, label: "Security" },
      { href: `${base}/adoption`, label: "Adoption" },
      { href: `${base}/delivery`, label: "Delivery" },
      { href: `${base}/contributors`, label: "Contributors" },
      { href: `${base}/teams`, label: "Teams" },
    ] },
    { label: "Plan", tabs: [
      { href: `${base}/practices`, label: "Practices" },
      { href: `${base}/plan`, label: "Plan" },
      { href: `${base}/backlog`, label: "Backlog" },
    ] },
    { label: "Library", tabs: [
      { href: `${base}/skills`, label: "Skills" },
    ] },
    { label: "Govern", tabs: [
      { href: `${base}/members`, label: "Members" },
      { href: `${base}/governance`, label: "Governance" },
      { href: `${base}/audit`, label: "Audit" },
      { href: `${base}/settings`, label: "Settings" },
    ] },
  ];

  const groups: SideNavGroup[] = def.map((g) => ({
    label: g.label,
    items: g.tabs.map((t) => ({ label: t.label, href: t.href, active: path === t.href })),
  }));

  return <SideNav groups={groups} ariaLabel="Organization sections" />;
}
