import Link from "next/link";

/**
 * Login-time org auto-discovery panel (extracted from connect/page.tsx to keep that file under the
 * 300-LOC cap): a ready-to-explore seeded dashboard + the orgs the viewer belongs to but hasn't
 * connected yet. Renders nothing when there's neither, so the page can drop it in unconditionally.
 */
export function ConnectDiscovered({
  seededOrg,
  suggestedOrgs,
}: {
  seededOrg?: string | null;
  suggestedOrgs: string[];
}) {
  if (!seededOrg && suggestedOrgs.length === 0) return null;
  return (
    <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Discovered from your GitHub</div>
      {seededOrg && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-base text-slate-300">
            We pre-loaded <span className="font-mono text-white">{seededOrg}</span>&apos;s most active
            repositories onto your watchlist — its dashboard is ready to scan.
          </p>
          <Link
            href={`/org/${encodeURIComponent(seededOrg)}`}
            className="focus-ring shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-emerald-400"
          >
            View {seededOrg} dashboard →
          </Link>
        </div>
      )}
      {suggestedOrgs.length > 0 && (
        <div className="mt-3">
          <p className="text-base text-slate-400">
            You belong to {suggestedOrgs.length === 1 ? "this organization" : "these organizations"} —
            install the App to scan private repos, or{" "}
            <Link href="/onboarding" className="text-accent hover:text-white">
              scan their public repos now →
            </Link>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestedOrgs.map((o) => (
              <Link
                key={o}
                href="/onboarding"
                className="focus-ring rounded-full border border-slate-700 px-3 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
              >
                {o}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
