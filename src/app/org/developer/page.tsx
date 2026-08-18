import { Suspense } from "react";
import { OrgShell } from "@/components/org/shell/OrgShell";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { DeveloperHome } from "@/components/org/developer/DeveloperHome";
import { getDeveloperView } from "@/lib/org/developer-view-load";
import { resolveViewerLogin } from "@/lib/access";
import { canReadOrg } from "@/lib/authz";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { listOrgsForLogin, normalizeLogin } from "@/lib/db/members";

export const dynamic = "force-dynamic";

/**
 * `/org/developer` — the developer's own home (docs/REGISTRY-AND-CARE-IMPL.md §5.1).
 *
 * A STATIC segment, so it wins over `/org/[slug]`: this page is personalized to the AUTHENTICATED
 * viewer and shows their own activity, never someone else's. That is exactly why it is not a `?tab=`
 * panel — a panel is org-scoped and anyone with org access opens the same one. It still presents as a
 * rail item, so it renders the SAME `OrgShell` (header + rail + program strip) every org tab wears,
 * with the `developer` item lit.
 */
type SearchParams = { [key: string]: string | string[] | undefined };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Which org this page is read "inside": `?org=<slug>` when the viewer may actually read it, else the
 * viewer's first readable org (membership order — most privileged first), else their own personal
 * workspace (their login namespace), else the shared public org for a signed-out visitor (whose
 * OrgShell then renders the sign-in wall instead of any data).
 *
 * Every candidate passes `canReadOrg` BEFORE it is returned, so a hand-typed `?org=` can no more
 * reach another tenant's shell here than it could at `/org/<slug>` — and the view model below is only
 * ever loaded for a slug that cleared it.
 */
async function resolveDeveloperOrg(login: string | null, requested: string | undefined): Promise<string> {
  const asked = requested ? normalizeLogin(requested) : "";
  if (asked && (await canReadOrg(asked))) return asked;
  if (!login) return PUBLIC_ORG;
  const orgs = await listOrgsForLogin(login).catch(() => []);
  for (const o of orgs) {
    if (await canReadOrg(o.slug)) return o.slug;
  }
  const personal = normalizeLogin(login);
  if (personal && (await canReadOrg(personal))) return personal;
  return PUBLIC_ORG;
}

/** The data region. Nested inside OrgShell so it never runs when a shell guard short-circuits. */
async function DeveloperData({ login, slug }: { login: string | null; slug: string }) {
  const view = await getDeveloperView(login, slug);
  return <DeveloperHome view={view} slug={slug} />;
}

export default async function OrgDeveloperPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Resolve the viewer in the ROUTE BODY, before anything streams: cookie-scoped reads return null
  // inside a ReadableStream `start()` (memory: getviewer-not-in-sse-start).
  const login = await resolveViewerLogin();
  const slug = await resolveDeveloperOrg(login, first(sp.org));

  return (
    <OrgShell slug={slug} activeTab="developer">
      <div className="stagger-children space-y-6">
        <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
          <DeveloperData login={login} slug={slug} />
        </Suspense>
      </div>
    </OrgShell>
  );
}
