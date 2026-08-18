// The personal workspace's Overview — the individual-tier landing (Organization.kind === "personal").
// Renders the viewer's watched public repos as a lens over the SHARED public corpus: latest standing,
// scan-to-scan delta, a score sparkline, and the same trajectory GPS the org rollup uses — plus the
// add/untrack controls. No scan rows exist under the personal org itself (see src/lib/db/personal.ts).

import Link from "next/link";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Sparkline } from "@/features/standing/repositories/Sparkline";
import { Trajectory } from "@/features/standing/overview/Trajectory";
import { AddRepoForm, UntrackButton } from "@/components/org/PersonalWatchControls";
import { PassportCard } from "@/features/standing/passports/PassportCard";
import { EmptyState } from "@/components/EmptyState";
import { getPersonalPassports, getPersonalUsage, getPersonalWatchlist, PERSONAL_WATCH_LIMIT, type PersonalMeter, type PersonalRepo } from "@/lib/db";
import { LEVEL_GLYPH, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="font-mono text-sm text-slate-600">—</span>;
  const tone = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-slate-500";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "•";
  return (
    <span className={`font-mono text-sm tabular-nums ${tone}`} title="Change vs the previous scan">
      <span aria-hidden>{arrow}</span> {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}

function RepoRow({ repo }: { repo: PersonalRepo }) {
  const enc = encodeURIComponent(repo.fullName);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 py-3 last:border-b-0">
      <div className="min-w-48 flex-1">
        <Link href={`/report/${repo.owner}/${repo.name}`} className="focus-ring rounded font-medium text-slate-200 hover:text-white">
          {repo.fullName}
        </Link>
      </div>
      {repo.latest ? (
        <>
          <span className="inline-flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold tabular-nums" style={{ color: scoreHex(repo.latest.score) }}>
              {repo.latest.score}
            </span>
            <span className="font-mono text-sm text-slate-400" aria-hidden>
              {LEVEL_GLYPH[repo.latest.level as LevelId] ?? ""}
            </span>
            <span className="font-mono text-sm text-slate-400">{repo.latest.level}</span>
          </span>
          <DeltaChip delta={repo.delta} />
          {repo.series.length > 1 ? (
            <Sparkline
              values={repo.series.map((p) => p.score)}
              ariaLabel={`${repo.scanCount}-scan maturity sparkline for ${repo.fullName}`}
            />
          ) : (
            <span className="font-mono text-sm text-slate-600" title="The trend fills in after the next scan">
              baseline
            </span>
          )}
          <span className="flex items-center gap-2 font-mono text-sm">
            <Link href={`/trends?repo=${enc}`} className="focus-ring rounded text-slate-400 hover:text-white">
              Trends
            </Link>
            {repo.scanCount >= 2 && (
              <Link href={`/report/compare?repo=${enc}`} className="focus-ring rounded text-slate-400 hover:text-white">
                Compare
              </Link>
            )}
            <Link href={`/report?repo=${enc}`} className="focus-ring rounded text-slate-400 hover:text-white" title="Re-scan via the public report flow">
              Rescan
            </Link>
          </span>
        </>
      ) : (
        <span className="flex items-center gap-3 font-mono text-sm text-slate-500">
          not scanned yet
          <Link href={`/report?repo=${enc}`} className="focus-ring rounded text-accent hover:text-white">
            Scan →
          </Link>
        </span>
      )}
      <UntrackButton fullName={repo.fullName} />
    </li>
  );
}

function UsageChip({ label, meter }: { label: string; meter: PersonalMeter }) {
  const full = meter.used >= meter.limit;
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-mono text-sm tabular-nums ${full ? "border-amber-500/40 text-amber-400" : "border-slate-700 text-slate-400"}`}
      title={full ? `${label} limit reached` : `${label} used vs the free workspace limit`}
    >
      {label} {meter.used}/{meter.limit}
    </span>
  );
}

export async function PersonalOverview({ slug }: { slug: string }) {
  const [repos, usage, passports] = await Promise.all([
    getPersonalWatchlist(slug),
    getPersonalUsage(slug),
    getPersonalPassports(slug),
  ]);
  if (repos === null) {
    return (
      <EmptyState
        icon="🏔️"
        title="Workspace unavailable"
        body="Your personal workspace needs a database. Set DATABASE_URL, then reload."
        actions={[{ label: "← Home", href: "/" }]}
      />
    );
  }

  const withForecast = repos.filter((r) => r.forecast !== null);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          size="sm"
          title="Your repositories"
          description="Public repos you track: scores and history come from the shared public corpus, so every scan of these repos (yours or anyone's) grows the same trend."
          right={
            usage ? (
              // The free workspace's meters — the honest readout beside the 402s the write APIs
              // return at each cap (repos here; memories/skills on their own pages).
              <span className="flex flex-wrap items-center gap-2">
                <UsageChip label="repos" meter={usage.watched} />
                <UsageChip label="memories" meter={usage.memories} />
                <UsageChip label="skills" meter={usage.skills} />
              </span>
            ) : (
              <span className="font-mono text-sm text-slate-500">
                {repos.length}/{PERSONAL_WATCH_LIMIT} tracked
              </span>
            )
          }
        />
        <div className="mt-4">
          <AddRepoForm remaining={PERSONAL_WATCH_LIMIT - repos.length} />
        </div>
        {repos.length === 0 ? (
          <p className="mt-6 text-base text-slate-400">
            Track your first public repository to see its maturity standing, history, and trajectory here.
          </p>
        ) : (
          <ul className="mt-4">
            {repos.map((r) => (
              <RepoRow key={r.fullName} repo={r} />
            ))}
          </ul>
        )}
      </Card>

      {withForecast.length > 0 && (
        <section aria-label="Repository trajectories" className="grid gap-4 lg:grid-cols-2">
          {withForecast.map((r) => (
            <div key={r.fullName}>
              <div className="mb-1.5 font-mono text-sm uppercase tracking-widest text-slate-500">{r.fullName}</div>
              <Trajectory forecast={r.forecast!} />
            </div>
          ))}
        </section>
      )}

      {/* App Readiness Passports — the same cards the repo's own org (and the report hero) show,
          via the public-corpus lens. Read-only here: overrides belong to the repo's owning org. */}
      {passports && passports.length > 0 && (
        <section aria-label="App Readiness Passports" className="grid gap-4 lg:grid-cols-2">
          {passports.map((p) => (
            <div key={p.fullName}>
              <div className="mb-1.5 font-mono text-sm uppercase tracking-widest text-slate-500">{p.fullName}</div>
              <PassportCard passport={p.passport} repo={p.fullName} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
