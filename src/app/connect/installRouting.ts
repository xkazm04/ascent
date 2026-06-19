import type { Session } from "@/lib/auth";

// Pure install-routing derivation extracted VERBATIM from connect/page.tsx (the `installs` /
// `orgInSession` / `pendingInstall` / auth-off `installs.push` block). It decides, for an
// `?org=&installation_id=` arriving from the GitHub install redirect, whether to render a live
// <InstallationRepos> panel or a "Finish connecting / Re-sync" prompt.
//
// Contract (mirrors the page comment): when auth is ON and the org isn't yet in the session it must
// NOT appear in `installs` (so the 403-prone panel — /api/app/repos authorizes against the session —
// is never rendered) and surfaces as `pendingInstall` instead; when auth is OFF there's no session to
// re-sync, so the query-carried org is pushed into `installs` directly. `orgInSession` matches on
// `installation_id` by id when present, else on `login` case-insensitively. Pure over
// (session, org, installationId, authConfigured): no DOM, no wall-clock, no env reads.

export interface InstallEntry {
  login: string;
  id?: string;
}

export interface InstallView {
  installs: InstallEntry[];
  pendingInstall: string | null;
}

export function resolveInstallView({
  session,
  org,
  installationId,
  authConfigured,
}: {
  session: Session | null;
  org?: string;
  installationId?: string;
  authConfigured: boolean;
}): InstallView {
  const installs: { login: string; id?: string }[] = (session?.installations ?? []).map((i) => ({
    login: i.login,
    id: String(i.id),
  }));
  const orgInSession =
    !org ||
    installs.some((i) => (installationId ? i.id === installationId : i.login.toLowerCase() === org.toLowerCase()));
  const pendingInstall = org && authConfigured && !orgInSession ? org : null;
  if (org && !authConfigured && !orgInSession) {
    installs.push({ login: org, id: installationId });
  }
  return { installs, pendingInstall };
}
