import { redirect } from "next/navigation";
import { getViewer } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * /me — the individual's front door. Resolves the signed-in viewer and lands them on their personal
 * workspace at /org/{login} (an Organization with kind "personal", auto-claimed on first visit by the
 * identity-bound personal-namespace seed in src/lib/authz.ts — login === slug, so nobody can claim a
 * victim's namespace). Signed-out visitors go to /connect to sign in first; the org layout's own
 * login wall then covers the walked-back-in case.
 */
export default async function MePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/connect");
  redirect(`/org/${viewer.login.trim().toLowerCase()}`);
}
