import { redirect } from "next/navigation";
import { orgTabHref } from "@/lib/org/orgTabs";

export const dynamic = "force-dynamic";

// The Settings view moved into the org dashboard's single `?tab=` shell
// (docs/ORG-TABS-REFACTOR.md). This route is kept FOREVER as a permanent redirect, not deleted: 58
// link sites point at /org/{slug}/{segment}, including the weekly digest email and the alert pushes —
// links already sitting in inboxes that we cannot update. The target comes from orgTabHref so a
// future rename is one edit in orgTabs.ts.
//
// The owner gate this route used to run has MOVED to SettingsTab, which runs it FIRST, before any
// card is built — see SettingsTab.tsx and its co-located SettingsTab.test.tsx (the pinned
// no-`/erase/i`-for-non-owners assertion moved with it).
export default async function OrgSettingsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(orgTabHref(slug, "settings"));
}
