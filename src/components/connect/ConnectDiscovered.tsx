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
    <section className="mt-6 rounded-2xl border border-divider bg-surface/40 p-6">
      <div className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Discovered from your GitHub</div>
      {seededOrg && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
          <p className="text-base text-slate-300">
            We pre-loaded <span className="font-mono text-white">{seededOrg}</span>&apos;s most active
            repositories onto your watchlist — its dashboard is ready to scan.
          </p>
          <Link
            href={`/org/${encodeURIComponent(seededOrg)}`}
            className="focus-ring shrink-0 rounded-lg bg-success px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-success-soft"
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
            <Link
              href={suggestedOrgs.length === 1 ? `/onboarding?org=${encodeURIComponent(suggestedOrgs[0]!)}` : "/onboarding"}
              className="text-accent hover:text-white"
            >
              scan their public repos now →
            </Link>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Carry the org the user just clicked into the wizard (?org=), instead of dropping the
                intent at the door and landing them on a blank "choose a source" step. The wizard reads
                the param on mount and goes straight to that account's repo selection. */}
            {suggestedOrgs.map((o) => (
              <Link
                key={o}
                href={`/onboarding?org=${encodeURIComponent(o)}`}
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
