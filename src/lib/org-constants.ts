// Dependency-free org constants. Kept in its own leaf — importing NOTHING (no next/headers, no db,
// no auth) — so the server auth module, the client OrgSwitcher, and the db badge-analytics leaf can
// all share the literal without pulling each other's heavy dependencies into the wrong bundle. This
// replaces the three hand-maintained copies of the "public" sentinel that previously had to be kept
// in sync by comment.

/** The shared, non-org context for public scans. */
export const PUBLIC_ORG = "public";
