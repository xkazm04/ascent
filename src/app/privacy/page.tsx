// /privacy — the privacy policy for the public marketing surface. Static, factual prose that
// documents SHIPPED behavior only, each claim traceable to code:
//   - repo ingestion reads GitHub over the API and never persists source (src/lib/github/source.ts,
//     src/components/connect/PrivacyNotice.tsx)
//   - contributor attribution from recent commit metadata (computeContributors in src/lib/analyze/index.ts)
//   - Supabase GitHub OAuth sign-in (src/lib/supabase/*, .env.example "ACTIVE sign-in")
//   - Polar as the payment processor (src/lib/polar.ts, docs/features/billing/billing.md)
//   - retention windows + the purge cron and the on-demand erasure path (src/lib/db/retention.ts,
//     src/app/api/org/erase/route.ts)
//   - cookies actually set: auth session cookies + two functional preference cookies, nothing else
//     (src/lib/auth.ts SESSION_COOKIE/ACTIVE_ORG_COOKIE, src/lib/window.ts PERIOD_COOKIE)
// The contact block mirrors the pricing page's ASCENT_CONTACT_EMAIL pattern and degrades to the
// public GitHub issue tracker when no address is configured.

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { MAX_FILES } from "@/lib/github/source";

const CONTACT_EMAIL = process.env.ASCENT_CONTACT_EMAIL?.trim();
const FEEDBACK_URL = "https://github.com/xkazm04/ascent/issues";

export const metadata = {
  title: "Privacy policy — Ascent",
  description:
    "How Ascent handles repository data, contributor commit metadata, accounts, billing, cookies, retention, and data erasure.",
};

const H2 = "mt-10 text-xl font-semibold text-white";
const P = "mt-3 text-slate-400 leading-relaxed";
const LI = "mt-2 text-slate-400 leading-relaxed";
const EM = "text-slate-200";

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Privacy policy</h1>
        <p className="mt-2 font-mono text-sm uppercase tracking-widest text-slate-500">Last updated: August 4, 2026</p>

        <p className={P}>
          Ascent scores how AI-native an engineering organization is, based on the contents and history of its
          GitHub repositories. This policy explains what data the service reads, what it stores, what it never
          stores, and the controls you have over it.
        </p>

        <h2 className={H2}>Repository data</h2>
        <p className={P}>
          Ascent reads repositories over the GitHub API. It does not clone repositories, and it{" "}
          <span className={EM}>does not store your source code</span>. During a scan, a bounded sample of file
          contents (at most {MAX_FILES} files, plus CI workflow files, each truncated to a size budget) is read
          and sent to the deployment&apos;s configured AI inference provider to produce the score. What Ascent
          persists afterwards is the <span className={EM}>derived output only</span>: scores, evidence notes,
          recommendations, and repository metadata such as the repo name, default branch, and a detected
          tech-stack summary. The sampled file contents are discarded when the scan completes.
        </p>
        <ul className="mt-3 list-disc pl-5">
          <li className={LI}>
            <span className={EM}>Public repositories</span> are read anonymously or with a server-side token that
            only raises rate limits.
          </li>
          <li className={LI}>
            <span className={EM}>Private repositories</span> are read via the Ascent GitHub App using short-lived
            installation tokens, and only for organizations where an authorized person installed the App.
          </li>
        </ul>

        <h2 className={H2}>Contributor commit metadata</h2>
        <p className={P}>
          To measure AI adoption, a scan analyzes a recent window of commit metadata: author names and logins,
          commit messages, and dates. From this, Ascent attributes AI-assisted commit activity (for example,
          commits carrying an AI co-author trailer) to named contributors and stores those aggregated,
          per-contributor counts as part of the scan report. Commit metadata comes from data that is already
          public (public repositories) or that your organization authorized through the GitHub App installation
          (private repositories). Ascent does not use this data for any purpose other than producing your reports.
        </p>

        <h2 className={H2}>Account data</h2>
        <p className={P}>
          Signing in uses <span className={EM}>GitHub OAuth through Supabase</span>; it is the only sign-in
          method. Ascent receives your GitHub login, display name, and avatar. It never sees your GitHub
          password, and public scans require no account at all.
        </p>

        <h2 className={H2}>Billing</h2>
        <p className={P}>
          Paid plans and prepaid scan credits are processed by <span className={EM}>Polar</span>, our payment
          processor. Card and payment details are entered on and held by Polar; Ascent never receives them.
          Ascent stores only the order outcome it needs to grant what you bought: the product purchased, the
          organization it applies to, and the credits or plan granted.
        </p>

        <h2 className={H2}>Usage records</h2>
        <p className={P}>
          Ascent keeps scan usage records (which repo was scanned, when, and the token usage behind the cost
          estimate on the usage page) and an audit log of administrative actions in each organization. The
          weekly free-scan allowance for anonymous public scans is keyed by a{" "}
          <span className={EM}>salted hash</span> of the client IP address; the raw IP address is never stored.
        </p>

        <h2 className={H2}>Cookies</h2>
        <p className={P}>
          Ascent sets no advertising or tracking cookies and runs no third-party analytics. The cookies in use
          are:
        </p>
        <ul className="mt-3 list-disc pl-5">
          <li className={LI}>
            <span className={EM}>Authentication cookies</span>: the session cookies minted by the Supabase
            sign-in flow, plus short-lived cookies that exist only during the OAuth round-trip. These keep you
            signed in and are HTTP-only.
          </li>
          <li className={LI}>
            <span className={EM}>Preference cookies</span>: <span className="font-mono">ascent_active_org</span>{" "}
            remembers which workspace you last viewed, and <span className="font-mono">ascent_period</span>{" "}
            remembers your dashboard time-range selection. Neither is used to track you across sites.
          </li>
        </ul>

        <h2 className={H2}>Retention</h2>
        <p className={P}>
          By default, scan history is kept until you delete it. Each deployment (and each organization, via a
          per-org override) can configure retention windows: keep only the newest N scans per repository, and
          keep audit-log entries for N days. A daily purge job enforces the configured policy in the background
          and records what it removed in the audit log.
        </p>

        <h2 className={H2}>Deleting your data</h2>
        <p className={P}>
          Organization owners can erase their scan data <span className={EM}>on demand</span>, without waiting
          for any retention schedule: the erasure endpoint removes the organization&apos;s entire scan history
          (or a single repository&apos;s), including derived caches, and can optionally erase the
          organization&apos;s audit trail as well. Erasure requires owner permissions and a typed confirmation,
          and the operation itself leaves a single audit record of what was erased and when. For anything the
          self-serve path does not cover, contact us using the details below.
        </p>

        <h2 className={H2}>Who we share data with</h2>
        <p className={P}>
          Ascent shares data only with the processors needed to run the service: GitHub (repository reads and
          sign-in identity), Supabase (authentication), Polar (payments), the deployment&apos;s configured AI
          inference provider (the sampled file contents during a scan), an email provider for transactional mail
          you asked for (scan-completion notices, organization invites, alert digests), and the hosting
          infrastructure the service runs on. Ascent does not sell data, and does not share it for advertising.
        </p>

        <h2 className={H2}>Security</h2>
        <p className={P}>
          All traffic is encrypted in transit. Session cookies are signed and HTTP-only. Private-repository
          access uses short-lived GitHub App installation tokens that expire on their own; long-lived repository
          credentials are never stored for your account.
        </p>

        <h2 className={H2}>Changes and contact</h2>
        <p className={P}>
          When this policy changes, the date at the top changes with it. Questions or requests:{" "}
          {CONTACT_EMAIL ? (
            <a className="text-accent hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          ) : (
            <a className="text-accent hover:underline" href={FEEDBACK_URL} target="_blank" rel="noreferrer">
              open an issue on GitHub
            </a>
          )}
          . See also the <Link className="text-accent hover:underline" href="/terms">terms of service</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
