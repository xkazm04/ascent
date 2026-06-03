// /org/[slug]/live — the Fleet Command war-room. Seeds each repo's latest standing from the
// org rollup, then hands off to a client component that subscribes to the existing
// /api/org/scan SSE stream and animates the wall (headline tiles, leaderboard, posture mix,
// movers ticker, AI-Native bursts) as results land. The org layout supplies the auth/DB guards.

import { LiveWarRoom, type LiveRepoSeed } from "@/components/org/LiveWarRoom";
import { getOrgRollup } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OrgLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rollup = await getOrgRollup(slug);
  if (!rollup) return null;

  const watched = rollup.repos.filter((r) => r.watched).length;
  const seed: LiveRepoSeed[] = rollup.repos.map((r) => ({
    fullName: r.fullName,
    name: r.name,
    overall: r.latest?.overall ?? null,
    adoption: r.latest?.adoption ?? null,
    rigor: r.latest?.rigor ?? null,
    level: r.latest?.level ?? null,
    posture: r.latest?.posture ?? null,
  }));

  return <LiveWarRoom slug={slug} watchedCount={watched} seed={seed} />;
}
