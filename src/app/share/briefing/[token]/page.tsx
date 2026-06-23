// /share/briefing/[token] — a read-only executive briefing authorized by a signed expiring token
// (EXEC-6) instead of a session, so an owner can share it with a board member who has no account.
// Outside the /org layout (no session gate); the token is the capability and carries the window.
// Exposes only what the Briefing tab shows. noindex so a leaked link isn't crawled.

import { SiteFooter, SiteHeader } from "@/components/Brand";
import { Card, InlineEmpty, Meter, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { DimRow, PriorPeriodGrid } from "@/components/org/briefingShared";
import { buildExecBriefing } from "@/lib/org/briefing";
import { verifyBriefingShareToken } from "@/lib/briefing-share";
import { resolveWindow } from "@/lib/window";
import { getTechGroupIdByKey, isDbConfigured } from "@/lib/db";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-5 text-center">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-base text-slate-400">{body}</p>
      </main>
      <SiteFooter />
    </>
  );
}

export default async function SharedBriefingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyBriefingShareToken(token);
  if (!verified) {
    return <Notice title="Link expired or invalid" body="This shared briefing link is no longer valid. Ask an org owner for a fresh one." />;
  }
  if (!isDbConfigured()) return <Notice title="No data" body="This deployment has no database configured." />;

  const period = resolveWindow({ range: verified.range, from: verified.from, to: verified.to });
  // EXEC #1: re-run scoped to the segment the owner shared (carried in the signed token), so a reseller's
  // per-client read-only link shows that client's data — not the whole org. Feature 3b: the same for the
  // tech-stack scope (resolve the carried KEY → group id within the org).
  const techGroupId = await getTechGroupIdByKey(verified.org, verified.stack ?? null).catch(() => null);
  const briefing = await buildExecBriefing(verified.org, { start: period.start, end: period.end }, period.title, verified.segment ?? null, techGroupId).catch(() => null);
  if (!briefing) {
    return <Notice title="Nothing to show yet" body={`No scanned repositories for ${verified.org} yet.`} />;
  }
  const { maturity, benchmark, priorPeriod } = briefing;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2 font-mono text-sm text-slate-500">
          Read-only shared briefing · {briefing.periodTitle}
        </div>
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title={`${verified.org} — executive briefing`}
          description={`AI-native engineering maturity standing over ${briefing.periodTitle.toLowerCase()}.`}
        />

        <div className={`mt-6 ${TILE_GRID}`}>
          <Tile label="Org maturity" value={maturity.overall} sub={`${maturity.levelId} · ${maturity.levelName}`} color={scoreHex(maturity.overall)} delta={briefing.periodDelta ?? undefined} />
          <Tile label="AI Adoption" value={maturity.adoption} color={scoreHex(maturity.adoption)} />
          <Tile label="Engineering Rigor" value={maturity.rigor} color={scoreHex(maturity.rigor)} />
          <Tile label="Corpus percentile" value={benchmark?.percentile != null ? `${benchmark.percentile}` : "—"} sub={benchmark && benchmark.corpusRepos > 0 ? `vs ${benchmark.corpusRepos} repos` : "no corpus yet"} color={benchmark?.percentile != null ? scoreHex(benchmark.percentile) : undefined} />
        </div>

        {briefing.forecastHeadline && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="Trajectory" />
            <p className="mt-2 text-base text-slate-300">{briefing.forecastHeadline}</p>
          </Card>
        )}

        {priorPeriod && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="vs previous period" />
            <PriorPeriodGrid prior={priorPeriod} now={maturity} />
          </Card>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionHeader size="sm" title="Strengths" />
            <div className="mt-3 space-y-1.5">
              {briefing.strengths.map((d) => (
                <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} />
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader size="sm" title="Weakest dimensions" />
            <div className="mt-3 space-y-1.5">
              {briefing.risks.map((d) => (
                <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} />
              ))}
            </div>
          </Card>
        </div>

        <Card className="mt-6">
          <SectionHeader size="sm" title="Goals" />
          {briefing.goals.length === 0 ? (
            <InlineEmpty>No goals set for this org.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-2.5">
              {briefing.goals.map((g) => (
                <div key={g.label} className="flex items-center gap-3 text-base">
                  <span className="min-w-0 flex-1 truncate text-slate-300">{g.label}</span>
                  <Meter className="w-32 shrink-0" value={g.pct} color={scoreHex(g.pct)} />
                  <span className="w-28 shrink-0 text-right font-mono text-sm text-slate-400">{g.current}/{g.target}{g.etaDays != null ? ` · ~${g.etaDays}d` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}
