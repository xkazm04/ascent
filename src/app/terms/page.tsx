// /terms — terms of service for the public marketing surface. Documents SHIPPED behavior only:
// Supabase GitHub OAuth sign-in, the public/private scan split and GitHub App authorization
// (src/lib/github/*), Polar billing with monthly allowances + non-expiring prepaid credits
// (src/lib/plans.ts, docs/features/billing/billing.md), AI-generated scores as informational
// output (src/lib/scoring/*), and the owner-gated erasure path (src/app/api/org/erase/route.ts).
// Contact mirrors the pricing page's ASCENT_CONTACT_EMAIL pattern with a GitHub-issues fallback.

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";

const CONTACT_EMAIL = process.env.ASCENT_CONTACT_EMAIL?.trim();
const FEEDBACK_URL = "https://github.com/xkazm04/ascent/issues";

export const metadata = {
  title: "Terms of service · Ascent",
  description:
    "The terms that govern using Ascent: accounts, scan permissions, plans and credits, AI-generated reports, and your data.",
};

const H2 = "mt-10 text-xl font-semibold text-white";
const P = "mt-3 text-slate-400 leading-relaxed";
const LI = "mt-2 text-slate-400 leading-relaxed";
const EM = "text-slate-200";

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Terms of service</h1>
        <p className="mt-2 font-mono text-sm uppercase tracking-widest text-slate-500">Last updated: August 4, 2026</p>

        <p className={P}>
          These terms govern your use of Ascent, a service that scores how AI-native an engineering
          organization is based on its GitHub repositories. By using the service you agree to them. How data is
          handled is described separately in the{" "}
          <Link className="text-accent hover:underline" href="/privacy">
            privacy policy
          </Link>
          .
        </p>

        <h2 className={H2}>The service</h2>
        <p className={P}>
          Ascent reads a repository over the GitHub API, analyzes it with a combination of deterministic checks
          and AI inference, and produces a maturity score, evidence, and recommendations. Public-repository
          scans are free and require no account. Private-repository scans and organization features require
          signing in and installing the Ascent GitHub App.
        </p>

        <h2 className={H2}>Accounts</h2>
        <p className={P}>
          Sign-in is with your GitHub account via Supabase; there is no separate password to manage. You are
          responsible for activity that happens under your session. You can sign out at any time, and sessions
          expire on their own after a period of inactivity.
        </p>

        <h2 className={H2}>Scan permissions</h2>
        <p className={P}>
          You may only scan repositories you are entitled to access. Public scans read publicly available
          data. Private scans are authorized by installing the GitHub App on an organization, which only a
          person with the right GitHub permissions can do; access to the resulting reports is limited to
          members of that organization. Do not use the service to probe repositories you have no rights to, to
          circumvent rate limits or scan quotas, or to disrupt the service or third-party services it relies
          on.
        </p>

        <h2 className={H2}>Plans, credits, and billing</h2>
        <ul className="mt-3 list-disc pl-5">
          <li className={LI}>
            Payments are processed by <span className={EM}>Polar</span>. Prices and what each plan includes are
            listed on the <Link className="text-accent hover:underline" href="/pricing">pricing page</Link>.
          </li>
          <li className={LI}>
            Public scans are always free. Each plan includes a monthly private-scan allowance that{" "}
            <span className={EM}>resets on the 1st of each month (UTC)</span>.
          </li>
          <li className={LI}>
            Private scans beyond the allowance run on prepaid credits (1 credit per scan). Prepaid credits{" "}
            <span className={EM}>roll over and do not expire</span>. Cached re-scans of unchanged repositories
            are free.
          </li>
          <li className={LI}>
            Subscriptions renew monthly until cancelled. Cancelling stops future renewals; already-purchased
            prepaid credits remain usable.
          </li>
        </ul>

        <h2 className={H2}>Scores and reports</h2>
        <p className={P}>
          Scores, evidence, and recommendations are generated in part by AI models and are{" "}
          <span className={EM}>informational</span>. They reflect what the scan could observe in a bounded
          sample of a repository at a point in time. They are not a certification, a security audit, or
          professional advice, and Ascent does not guarantee their accuracy or completeness. Decisions you make
          based on a report are your own.
        </p>

        <h2 className={H2}>Your content</h2>
        <p className={P}>
          Your code stays yours. Ascent claims no ownership of anything it reads from your repositories, stores
          no source code, and uses repository data only to produce your reports, as described in the privacy
          policy. Reports and badges for public repositories may appear on public surfaces of the service, such
          as the leaderboard, which reflect data that is already public on GitHub.
        </p>

        <h2 className={H2}>Availability and changes</h2>
        <p className={P}>
          The service is provided <span className={EM}>as is</span>, without warranties of any kind. We may
          change, suspend, or discontinue features, and we may update scoring models over time, which can change
          scores without any change in your repository. We aim for accuracy and stability but do not promise
          uninterrupted availability.
        </p>

        <h2 className={H2}>Liability</h2>
        <p className={P}>
          To the maximum extent permitted by law, Ascent is not liable for indirect, incidental, or
          consequential damages arising from use of the service, and its total liability for any claim is
          limited to the amount you paid for the service in the twelve months before the claim arose.
        </p>

        <h2 className={H2}>Termination</h2>
        <p className={P}>
          You can stop using the service at any time. Organization owners can erase their organization&apos;s
          scan data on demand through the self-serve erasure path described in the privacy policy. We may
          suspend or terminate access that violates these terms or abuses the service.
        </p>

        <h2 className={H2}>Changes and contact</h2>
        <p className={P}>
          When these terms change, the date at the top changes with it; continued use after a change means you
          accept the updated terms. Questions:{" "}
          {CONTACT_EMAIL ? (
            <a className="text-accent hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          ) : (
            <a className="text-accent hover:underline" href={FEEDBACK_URL} target="_blank" rel="noreferrer">
              open an issue on GitHub
            </a>
          )}
          .
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
