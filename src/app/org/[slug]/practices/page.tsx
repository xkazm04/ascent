import Link from "next/link";
import { Card, Meter, SectionEmpty, SectionHeader } from "@/components/org/ui";
import { PracticeApply } from "@/components/org/PracticeApply";
import { PlaybooksPanel } from "@/components/org/PlaybooksPanel";
import { getOrgPractices, getOrgRollup, getPlaybookAdoption, listPlaybooks } from "@/lib/db";
import { DIMENSIONS } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function OrgPractices({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [playbooks, adoption, rollup, practices] = await Promise.all([
    listPlaybooks(slug),
    getPlaybookAdoption(slug),
    getOrgRollup(slug),
    getOrgPractices(slug),
  ]);
  const dimOptions = DIMENSIONS.map((d) => ({ id: d.id, label: d.name }));
  const repoOptions = (rollup?.repos ?? []).map((r) => r.fullName).sort();

  return (
    <div className="space-y-6">
      <PlaybooksPanel
        slug={slug}
        initial={playbooks ?? []}
        dimOptions={dimOptions}
        adoption={adoption}
        repoOptions={repoOptions}
      />

      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="Practice Library"
        description={
          <>
            Your org&apos;s playbook, mined from its own strongest repos. Each practice points to an internal{" "}
            <span className="text-slate-300">exemplar to learn from</span> and the repos that could{" "}
            <span className="text-slate-300">adopt it next</span> — the reusable shape travels, the proprietary code doesn&apos;t.
          </>
        }
      />

      {(!practices || practices.length === 0) && (
        <SectionEmpty>No mined practices yet — scan some of this org&apos;s repositories to surface them.</SectionEmpty>
      )}
      {(practices ?? []).map((p) => {
        // `total` is the # of repos evaluated for this practice. When it's 0 (no repo scored on the
        // practice's dimension yet) the old tile rendered a meaningless "0/0 · 0%" with a flat meter;
        // show a "not yet measured" state instead so an unmeasured practice doesn't read as 0% adoption.
        const measured = p.total > 0;
        const adoptionPct = measured ? Math.round((p.strongCount / p.total) * 100) : 0;
        return (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-white">{p.label}</h3>
                <p className="mt-1 text-base text-slate-400">{p.what}</p>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className="font-mono text-2xl font-bold tabular-nums"
                  style={{ color: measured ? scoreHex(adoptionPct) : undefined }}
                >
                  {measured ? `${p.strongCount}/${p.total}` : "—"}
                </div>
                <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
                  {measured ? "repos strong" : "not yet measured"}
                </div>
              </div>
            </div>

            {measured && <Meter className="mt-3" size="sm" value={adoptionPct} color={scoreHex(adoptionPct)} />}

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {/* Exemplar + gaps */}
              <div className="space-y-3 text-base">
                <div>
                  <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Learn from</span>
                  {p.exemplar ? (
                    <div className="mt-1">
                      <Link href={`/report?repo=${encodeURIComponent(p.exemplar.fullName)}`} className="font-mono text-base text-white hover:text-accent">
                        {p.exemplar.name}
                      </Link>
                      <span className="ml-2 font-mono text-sm" style={{ color: scoreHex(p.exemplar.score) }}>
                        {p.exemplar.score}/100
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-slate-500">No strong exemplar yet — this is greenfield for the org.</div>
                  )}
                </div>
                <div>
                  <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
                    Could adopt next ({p.gapRepos.length})
                  </span>
                  {p.gapRepos.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.gapRepos.slice(0, 10).map((r) => (
                        <span key={r} className="rounded border border-orange-500/30 bg-orange-500/5 px-1.5 py-0.5 font-mono text-sm text-orange-200">
                          {r}
                        </span>
                      ))}
                      {p.gapRepos.length > 10 && <span className="font-mono text-sm text-slate-600">+{p.gapRepos.length - 10}</span>}
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-slate-500">No clear gaps — well adopted across the fleet.</div>
                  )}
                </div>
              </div>

              {/* Reusable shape (leak-free starter) */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="font-mono text-sm uppercase tracking-widest text-accent">Reusable shape</div>
                <ul className="mt-2 space-y-1 text-base text-slate-300">
                  {p.starter.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="select-none text-slate-600">·</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Systematic apply: generate the starter + open a draft PR into a gap repo. */}
            <PracticeApply practiceId={p.id} gapRepos={p.gapRepoRefs} />
          </Card>
        );
      })}
    </div>
  );
}
