import type { OrgRole } from "@/lib/db/members";

/** Canonical role order (highest → lowest privilege) for the role selectors. */
export const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];

/** Roles an INVITE may grant. POST /api/org/invites categorically rejects "owner" (owner is granted
 *  only by promoting an existing member through the audited member-role editor), so offering it in
 *  the invite select was a guaranteed post-submit 400 — the server policy never made it into the UI
 *  contract. The server check stays as defense-in-depth. (ambiguity-ui 2026-07-16 #3) */
export const INVITE_ROLES: OrgRole[] = ROLES.filter((r) => r !== "owner");

/** One-line capability hint per role — surfaced as the role select's title. */
export const ROLE_HINT: Record<OrgRole, string> = {
  owner: "Full control, incl. member management & billing",
  admin: "Destructive ops (deletes, credit grants)",
  member: "Can act on the org (scan, watch, plan)",
  viewer: "Read-only access to dashboards",
};
