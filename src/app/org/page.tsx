import { redirect } from "next/navigation";
import { getActiveOrg, getSessionState } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Bare /org has no dashboard of its own — it forwards to the viewer's remembered org (set via
 * the header switcher), so the whole app follows their tenant context instead of resetting.
 * The /org/[slug] layout still applies its own auth/DB/empty guards on the destination, so a
 * signed-out visitor (resolved to "public") simply lands on the sign-in prompt there.
 */
export default async function OrgIndexPage() {
  const { session } = await getSessionState();
  const org = await getActiveOrg(session);
  redirect(`/org/${encodeURIComponent(org)}`);
}
