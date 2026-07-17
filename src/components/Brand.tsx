import Image from "next/image";
import Link from "next/link";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { SupabaseSignInButton, SignOutButton } from "@/components/SupabaseAuthButtons";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { getActiveOrg, getSession, isAuthConfigured, orgOptionsForSession } from "@/lib/auth";
import { getViewer, supabaseAuthConfigured } from "@/lib/access";
import { isDbConfigured, listOrgsForLogin } from "@/lib/db";
import { demoOrgHref } from "@/lib/site";
import { SiteFooterCore } from "@/components/SiteFooterCore";
import { HEADER_INNER, HEADER_NAV, HEADER_SHELL, MarketingNavLinks } from "@/components/StaticNav";
import { scoreHex } from "@/lib/ui";

/** Generated ascending-chevron mark + mono wordmark (Altimeter identity). */
export function Logo({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/brand/logo-mark-nobg.png"
        alt=""
        width={size}
        height={size}
        priority
        style={{ width: size, height: size }}
      />
      <span className="font-mono text-base font-semibold uppercase tracking-[0.22em] text-white">
        Ascent
      </span>
    </span>
  );
}

/**
 * The account cluster shared by both headers: org switcher (when the viewer has installations) + the
 * signed-in identity + sign out, or the sign-in / get-started affordance. Extracted so the marketing
 * SiteHeader and the dashboard OrgHeader render the SAME auth chrome without duplicating the
 * Supabase-vs-custom-OAuth branching.
 */
async function HeaderAccount() {
  const session = await getSession();
  const authOn = isAuthConfigured();
  // Supabase is the active login when configured; when it isn't, the header falls back to the
  // dormant custom-OAuth branches below (unchanged).
  const supaOn = supabaseAuthConfigured();
  const viewer = supaOn ? await getViewer() : null;
  // Show the org switcher only when the viewer actually has an org to switch to — with no
  // installations the menu would just read "Public" and be pointless.
  const showSwitcher = Boolean(authOn && session && session.installations.length > 0);
  const orgOptions = showSwitcher ? orgOptionsForSession(session) : [];
  const activeOrg = showSwitcher ? await getActiveOrg(session) : "public";

  if (supaOn) {
    return viewer ? (
      <span className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-slate-200">
          {viewer.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.avatar} alt="" className="h-6 w-6 rounded-full border border-slate-700" />
          )}
          <span className="max-w-[7rem] truncate normal-case tracking-normal sm:max-w-none">
            {viewer.login}
          </span>
        </span>
        <SignOutButton />
      </span>
    ) : (
      <SupabaseSignInButton variant="nav" next="/" />
    );
  }
  if (authOn && session) {
    return (
      <span className="flex items-center gap-3">
        {showSwitcher && <OrgSwitcher orgs={orgOptions} active={activeOrg} />}
        <Link href="/connect" className="focus-ring flex items-center gap-2 rounded-sm text-slate-200 hover:text-white">
          {session.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.image} alt="" className="h-6 w-6 rounded-full border border-slate-700" />
          )}
          <span className="max-w-[7rem] truncate normal-case tracking-normal sm:max-w-none">{session.login}</span>
        </Link>
        <form action="/api/auth/logout" method="post" className="contents">
          <button type="submit" className="focus-ring rounded-sm hover:text-white">
            Sign out
          </button>
        </form>
      </span>
    );
  }
  if (authOn) {
    return <GitHubSignInButton variant="nav" next="/connect" />;
  }
  return (
    <Link
      href="/onboarding"
      className="focus-ring rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent transition hover:bg-accent-soft"
    >
      Get started
    </Link>
  );
}

/**
 * The header's org-entry affordance. For a signed-in viewer who belongs to a real org this becomes a
 * direct link INTO that org (labelled with its name), and the generic demo link is dropped; for a
 * signed-out viewer — or one signed in but without an org yet — it stays the neutral "Org demo" link.
 * Resolves the viewer's login across BOTH identity models (the custom-OAuth session or the
 * Supabase/dev viewer) and reads their memberships. Rendered only when a database is configured (with
 * no DB there are no org rows to enter, so the demo link is meaningless too).
 */
async function OrgEntryLink() {
  if (!isDbConfigured()) return null;
  const [session, viewer] = await Promise.all([getSession(), getViewer()]);
  const login = session?.login ?? viewer?.login ?? null;
  // The viewer's primary org (most privileged, then most recent). Undefined ⇒ no org yet ⇒ demo link.
  const primary = login ? (await listOrgsForLogin(login))[0] : undefined;

  if (primary) {
    return (
      <Link
        href={`/org/${primary.slug}`}
        className="focus-ring flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-slate-100 transition hover:border-accent hover:bg-accent/20 hover:text-white"
        title={`Enter ${primary.name}`}
      >
        <span className="max-w-[11rem] truncate normal-case tracking-normal">{primary.name}</span>
        <span aria-hidden>→</span>
      </Link>
    );
  }
  return (
    <Link
      href={demoOrgHref()}
      className="focus-ring rounded-md border border-divider px-3 py-1.5 text-slate-200 transition hover:border-accent hover:text-white"
    >
      Org demo
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className={HEADER_SHELL}>
      <div className={HEADER_INNER}>
        <Link href="/" className="focus-ring rounded-sm">
          <Logo />
        </Link>
        <nav className={HEADER_NAV}>
          {/* Page-level nav only — section links (Levels / Method / Pricing) live inside the deck's
              right-edge section nav now, not the topbar. The static link list is shared with the
              404's StaticHeader via StaticNav so the two can't drift. */}
          <MarketingNavLinks />
          <OrgEntryLink />
          <HeaderAccount />
        </nav>
      </div>
    </header>
  );
}

/**
 * Org dashboard header — replaces the marketing SiteHeader on /org/[slug]. It drops the marketing nav
 * (Leaderboard / Pricing / About / Org demo) and folds the org's persistent context (name · maturity ·
 * your role) plus its actions (alerts · credits · scan) into the top bar, so the dashboard body opens
 * straight into page content and never repeats these controls. Actions are passed in by the layout
 * (which owns their data); the account cluster is shared with SiteHeader via HeaderAccount.
 */
/**
 * The org dashboard's horizontal shell — the sticky header bar and the page's <main> share it so the
 * logo/actions stay aligned with the content beneath them. Deliberately wider than the marketing
 * shell's max-w-7xl: the dashboard is a data surface, and that cap stranded most of a wide display in
 * dead side margin while the two-level rail took its 240px out of the module content. 120rem still
 * holds table rows and prose to a readable measure. The cap only binds above 1920px, so laptops and
 * ordinary desktops simply fill the viewport.
 */
export const ORG_SHELL = "mx-auto w-full max-w-[120rem] px-5";

export function OrgHeader({
  slug,
  levelId,
  score,
  role,
  actions,
}: {
  slug: string;
  levelId: string;
  score: number;
  /** The viewer's role in this org (e.g. "owner"); omitted for the public org / non-members. */
  role?: string | null;
  /** Alerts · credits · scan — assembled by the layout, rendered in the right cluster. */
  actions?: React.ReactNode;
}) {
  return (
    <header className={HEADER_SHELL}>
      <div className={`${ORG_SHELL} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3`}>
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="focus-ring shrink-0 rounded-sm" title="Ascent home">
            <Logo />
          </Link>
          <span aria-hidden className="hidden h-6 w-px shrink-0 bg-divider sm:block" />
          <span className="truncate text-lg font-bold text-white" title={slug}>
            {slug}
          </span>
          <span
            className="shrink-0 rounded-md border border-slate-700 px-2 py-0.5 font-mono text-sm tabular-nums"
            style={{ color: scoreHex(score) }}
            title="Fleet maturity — level · index score"
          >
            {levelId} · {score}
          </span>
          {role && (
            <span
              className="shrink-0 rounded-md border border-accent/40 bg-accent/5 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-accent"
              title="Your role in this organization"
            >
              {role}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {actions && <span aria-hidden className="hidden h-6 w-px bg-divider sm:block" />}
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  // Content (brand slot aside) is single-sourced in SiteFooterCore — shared with /about's inline
  // client footer (AboutCTA), which can't import this server component.
  return (
    <footer className="mt-auto border-t border-divider/70 py-8 text-center text-base text-slate-400">
      <div className="mx-auto max-w-6xl px-5">
        <SiteFooterCore brand={<Logo className="justify-center opacity-80" />} />
      </div>
    </footer>
  );
}
