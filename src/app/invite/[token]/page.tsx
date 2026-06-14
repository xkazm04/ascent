// /invite/[token] — accept an org invitation. The signed-in GitHub login is granted the invite's
// role (acceptInvite → setMembershipRole) on load; a pinned-login invite refuses anyone else.
// Signed-out visitors get the sign-in wall with this URL as the post-login destination.

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { SignInNotice } from "@/components/SignInNotice";
import { acceptInvite, isDbConfigured } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl px-5 py-12">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

function Card({ title, body, cta }: { title: string; body: React.ReactNode; cta?: { href: string; label: string } }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-center">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-base text-slate-400">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

const REASON: Record<string, { title: string; body: string }> = {
  not_found: { title: "Invite not found", body: "This invitation link is invalid. Ask an owner to send a new one." },
  expired: { title: "Invite expired", body: "This invitation has expired. Ask an owner to send a fresh one." },
  used: { title: "Invite already used", body: "This invitation was already accepted or revoked." },
  wrong_user: { title: "Wrong account", body: "This invitation was issued to a different GitHub account. Sign in as that user to accept it." },
  db: { title: "Couldn't accept the invite", body: "Something went wrong applying the invitation. Try again, or ask an owner to re-send." },
};

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isDbConfigured()) {
    return (
      <Frame>
        <Card title="Invites need a database" body="This deployment has no database configured, so invitations can't be accepted here." />
      </Frame>
    );
  }
  const session = isAuthConfigured() ? await getSession() : null;
  if (isAuthConfigured() && !session) {
    return (
      <Frame>
        <SignInNotice next={`/invite/${token}`} />
      </Frame>
    );
  }
  if (!session) {
    return (
      <Frame>
        <Card title="Authentication required" body="Accepting an invite needs GitHub authentication configured on this deployment." />
      </Frame>
    );
  }

  const result = await acceptInvite(token, session.login);
  if (result.ok) {
    return (
      <Frame>
        <Card
          title={`You've joined ${result.org}`}
          body={`You now have the ${result.role} role in ${result.org}.`}
          cta={{ href: `/org/${encodeURIComponent(result.org)}`, label: "Open the org dashboard →" }}
        />
      </Frame>
    );
  }
  const r = REASON[result.reason] ?? REASON.db!;
  return (
    <Frame>
      <Card title={r.title} body={r.body} cta={{ href: "/", label: "Back to Ascent" }} />
    </Frame>
  );
}
