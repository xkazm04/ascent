// /portfolio?orgs=a,b,c — the cross-org "fleet of fleets" view (THEO). Rolls up several organizations'
// engineering maturity into one comparable table for a PE / portfolio engineering lead. Every org is
// authorized individually (canReadOrg) so the comparison can never surface a tenant the viewer can't
// already read; an unreadable/unknown slug is silently dropped and counted, not leaked.

import { SiteFooter, SiteHeader } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { canReadOrg } from "@/lib/authz";
import { buildPortfolio } from "@/lib/org/portfolio";
import { PortfolioTable } from "./PortfolioTable";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Portfolio — Ascent",
  description: "Compare AI-native engineering maturity, trajectory and posture across a portfolio of organizations.",
};

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ orgs?: string }> }) {
  const sp = await searchParams;
  const requested = (typeof sp.orgs === "string" ? sp.orgs : "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
  const dedup = [...new Set(requested)];

  // Authorize per org — only the ones the viewer may read survive (no cross-tenant leak).
  const readable = (await Promise.all(dedup.map(async (o) => ((await canReadOrg(o)) ? o : null)))).filter(
    (o): o is string => o !== null,
  );
  const portfolio = readable.length ? await buildPortfolio(readable) : null;
  const hidden = dedup.length - readable.length;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-5 py-10">
        <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Portfolio</div>
        <h1 className="mt-1 text-2xl font-bold text-white">Engineering maturity across the book</h1>
        <p className="mt-2 max-w-2xl text-base text-slate-400">
          Compare AI-native engineering maturity, trajectory and posture across several organizations on one yardstick —
          the fleet-of-fleets read for a portfolio or platform lead.
        </p>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            <span>Organizations (comma-separated slugs)</span>
            <input
              name="orgs"
              defaultValue={dedup.join(", ")}
              placeholder="vercel, prisma, …"
              className="w-96 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/20"
          >
            Compare
          </button>
        </form>

        {hidden > 0 && (
          <p className="mt-3 text-sm text-warn">
            {hidden} organization{hidden === 1 ? "" : "s"} hidden — no read access (or no such org).
          </p>
        )}

        <div className="mt-8">
          {!portfolio || portfolio.companies.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title={dedup.length ? "No readable organizations with scans" : "Add organizations to compare"}
              body={
                dedup.length
                  ? "None of the requested organizations are readable by you, or none have scanned repositories yet."
                  : "Enter a few organization slugs above (e.g. vercel, prisma) to roll up their engineering maturity side by side."
              }
            />
          ) : (
            <PortfolioTable portfolio={portfolio} />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
