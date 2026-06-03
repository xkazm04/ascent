// The overview's goals panel — the admin-defined, time-bound targets that replaced the single
// hardcoded "reach AI-Native" goal. Shows the top few active goals with progress, pace and a
// trend-derived ETA; the full set (and the create form) lives on the Plan tab. Server-safe.
import Link from "next/link";
import { Card, SectionHeader } from "@/components/org/ui";
import { GoalCard, type GoalProgressView } from "@/components/org/plan/goalView";

const OVERVIEW_LIMIT = 3;

export function GoalsOverview({ slug, goals }: { slug: string; goals: GoalProgressView[] }) {
  const active = goals.filter((g) => g.status !== "archived");
  const shown = active.slice(0, OVERVIEW_LIMIT);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Goals"
        right={
          <Link href={`/org/${slug}/plan`} className="font-mono text-[11px] uppercase tracking-widest text-accent hover:text-white">
            manage →
          </Link>
        }
      />
      {shown.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-800 bg-slate-950/30 p-5 text-center">
          <p className="text-sm text-slate-300">No goals set yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Define time-bound org targets — e.g. &ldquo;AI Adoption 60 by December&rdquo; or &ldquo;reach AI-Native by Q3&rdquo; — and track
            pace, ETA, and which repos must move against them.
          </p>
          <Link
            href={`/org/${slug}/plan`}
            className="mt-3 inline-block rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/20"
          >
            Set a goal →
          </Link>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {shown.map((g) => (
            <GoalCard key={g.id} goal={g} slug={slug} compact />
          ))}
          {active.length > shown.length && (
            <Link
              href={`/org/${slug}/plan`}
              className="block text-center font-mono text-[11px] text-slate-500 hover:text-accent"
            >
              +{active.length - shown.length} more on the Plan tab →
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
