// /org/[slug]/live — the Fleet Command war-room. Seeds each repo's latest standing from the
// org rollup, then hands off to a client component that subscribes to the existing
// /api/org/scan SSE stream and animates the wall (headline tiles, leaderboard, posture mix,
// movers ticker, AI-Native bursts) as results land. The org layout supplies the auth/DB guards.

import { LiveWarRoom, type LiveRepoSeed } from "@/components/org/LiveWarRoom";
import { getOrgRollup, listGoals } from "@/lib/db";
import type { GoalProgressView } from "@/components/org/plan/goalView";

export const dynamic = "force-dynamic";

export default async function OrgLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // The goal the wall rallies around — the first not-yet-achieved goal, else the most recent. Its
  // createdAt doubles as the campaign-start baseline for the "since kickoff" delta (WAR-2).
  const goals = await listGoals(slug).catch(() => null);
  const goal = goals?.find((g) => !g.achieved) ?? goals?.[0] ?? null;
  const rollup = await getOrgRollup(slug, goal ? { start: new Date(goal.createdAt) } : undefined);
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

  return (
    <LiveWarRoom
      slug={slug}
      watchedCount={watched}
      seed={seed}
      goal={(goal as GoalProgressView | null) ?? null}
      campaignDelta={goal ? rollup.deltas?.overall ?? null : null}
    />
  );
}
