import type { OrgRole } from "@/lib/db/members";

/** Canonical role order (highest → lowest privilege) for the role selectors. */
export const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];

/** One-line capability hint per role — surfaced as the role select's title. */
export const ROLE_HINT: Record<OrgRole, string> = {
  owner: "Full control, incl. member management & billing",
  admin: "Destructive ops (deletes, credit grants)",
  member: "Can act on the org (scan, watch, plan)",
  viewer: "Read-only access to dashboards",
};
