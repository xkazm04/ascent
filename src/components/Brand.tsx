import Image from "next/image";
import Link from "next/link";
import { GitHubSignInButton } from "@/components/GitHubSignInButton";
import { SupabaseSignInButton, SignOutButton } from "@/components/SupabaseAuthButtons";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { getActiveOrg, getSession, isAuthConfigured, orgOptionsForSession } from "@/lib/auth";
import { getViewer, supabaseAuthConfigured } from "@/lib/access";
import { isDbConfigured } from "@/lib/db";

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

export async function SiteHeader() {
  const session = await getSession();
  const authOn = isAuthConfigured();
  const dbOn = isDbConfigured();
  // Supabase is the active login when configured; when it isn't, the header falls back to the
  // dormant custom-OAuth branches below (unchanged).
  const supaOn = supabaseAuthConfigured();
  const viewer = supaOn ? await getViewer() : null;
  // Show the org switcher only when the viewer actually has an org to switch to — with no
  // installations the menu would just read "Public" and be pointless.
  const showSwitcher = Boolean(authOn && session && session.installations.length > 0);
  const orgOptions = showSwitcher ? orgOptionsForSession(session) : [];
  const activeOrg = showSwitcher ? await getActiveOrg(session) : "public";
  return (
    <header className="sticky top-0 z-30 border-b border-divider/70 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="focus-ring rounded-sm">
          <Logo />
        </Link>
        <nav className="flex items-center gap-3 font-mono text-sm uppercase tracking-widest text-slate-400 sm:gap-6">
          {/* Page-level nav only — section links (Levels / Method / Pricing) live inside the deck's
              right-edge section nav now, not the topbar. */}
          <Link href="/pricing" className="focus-ring hidden rounded-sm hover:text-white sm:inline">
            Pricing
          </Link>
          <Link href="/about" className="focus-ring hidden rounded-sm hover:text-white sm:inline">
            About
          </Link>
          {dbOn && (
            <Link
              href="/org/vercel"
              className="focus-ring rounded-md border border-divider px-3 py-1.5 text-slate-200 transition hover:border-accent hover:text-white"
            >
              Org demo
            </Link>
          )}
          {supaOn ? (
            viewer ? (
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
            )
          ) : authOn && session ? (
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
          ) : authOn ? (
            <GitHubSignInButton variant="nav" next="/connect" />
          ) : (
            <Link
              href="/onboarding"
              className="focus-ring rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent transition hover:bg-accent-soft"
            >
              Get started
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-divider/70 py-8 text-center text-base text-slate-400">
      <div className="mx-auto max-w-6xl px-5">
        <Logo className="justify-center opacity-80" />
        <p className="mt-3 font-mono text-sm uppercase tracking-widest text-slate-400">
          The maturity index for AI-native engineering
        </p>
        <div className="mt-3 flex justify-center gap-5 font-mono text-sm uppercase tracking-widest text-slate-400">
          <Link href="/pricing" className="focus-ring rounded-sm hover:text-accent">
            Pricing
          </Link>
          <Link href="/about" className="focus-ring rounded-sm hover:text-accent">
            About
          </Link>
          <Link href="/badge" className="focus-ring rounded-sm hover:text-accent">
            Badge
          </Link>
          <Link href="/connect" className="focus-ring rounded-sm hover:text-accent">
            Connect
          </Link>
          <Link href="/usage" className="focus-ring rounded-sm hover:text-accent">
            Usage
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Built on Vercel + Aurora DSQL · #H0Hackathon
        </p>
      </div>
    </footer>
  );
}
