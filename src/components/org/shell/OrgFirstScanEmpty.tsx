// The content slot of the org shell for a MEMBER's zero-repo fleet org (W6b — the state that used
// to be the "No data for <slug>" wall, which hid the entire shell). The rail and header render
// around this, so the member can already see what the dashboard will become; this slot's one job is
// to route them into the first scan. Server-safe (no hooks).

import { EmptyState } from "@/components/EmptyState";

export function OrgFirstScanEmpty({ slug }: { slug: string }) {
  return (
    <EmptyState
      icon="🛰️"
      title="Your dashboard is waiting for its first scan"
      body={
        <>
          Pick repositories in onboarding and <strong>{slug}</strong> fills in around you — instant
          preview scores first, then the live scan starts from this dashboard&apos;s header and
          upgrades them in place while you explore the tabs.
        </>
      }
      actions={[
        { label: "Run your first scan", href: "/onboarding", primary: true },
        { label: "Manage repos on Connect", href: "/connect" },
      ]}
    />
  );
}
