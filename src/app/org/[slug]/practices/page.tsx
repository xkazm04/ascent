// The "Practices" tab — Pillar 2's flagship surface. The library itself (authored playbooks + mined
// practices) is a dense client ledger; this server page fetches it and gives it the READING that
// Governance and Adoption already open with: a tile row of headline numbers and a Copy-for-LLM brief
// (practiceLibraryMarkdown), both folded from the data the ledger already needs — no extra query.

import { getOrgPractices, getOrgRollup, getPlaybookAdoption, listPlaybooks } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { buildPracticeLibrarySummary, practiceLibraryMarkdown } from "@/lib/org/practice-library";
import { DIMENSIONS } from "@/lib/maturity/model";
import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { BAND } from "../adoption/AdoptionSpectrum";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { CopyForLlm } from "@/components/CopyForLlm";
import { PracticesView } from "@/components/org/practices/PracticesView";

export const dynamic = "force-dynamic";

// Library adoption is a NEUTRAL accent reading, not the red→green maturity ramp: a young library with
// few adopted practices is an expected baseline, not a defect, so scoreHex would paint it alarm-red.
// Same rationale — and the same imported constant — as the Adoption tab's BAND.some.
const READING_HUE = BAND.some;

export default async function OrgPractices({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Optional tech-stack scope (Feature 3b): the MINED library honors a ?stack= param. The page used
  // to resolve this scope and then DISCARD techGroups/activeStack — filtering the library while
  // rendering no control, so ?stack= silently narrowed the table with nothing on screen to explain or
  // clear it (docs/harness/biz-bug-scan-2026-06-29). The selector now renders, same as every sibling
  // tab. No segment selector here: getOrgPractices' segment scope isn't wired on this surface yet.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const [playbooks, adoption, rollup, practices] = await Promise.all([
    listPlaybooks(slug),
    getPlaybookAdoption(slug),
    getOrgRollup(slug),
    getOrgPractices(slug, null, techGroupId),
  ]);
  const dimOptions = DIMENSIONS.map((d) => ({ id: d.id, label: d.name }));
  const repoOptions = (rollup?.repos ?? []).map((r) => r.fullName).sort();

  const summary = buildPracticeLibrarySummary(slug, practices ?? [], playbooks ?? [], adoption);
  const md = practiceLibraryMarkdown(summary);
  const roll = summary.rollout;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ScopeFilterBar segments={[]} segmentId={null} techGroups={techGroups} activeStack={activeStack} />
        <CopyForLlm text={md} label="Copy practice library brief for LLM" />
      </div>

      <div className={TILE_GRID}>
        <Tile
          label="Practices"
          value={summary.total}
          sub={`${summary.authored} authored · ${summary.mined} mined`}
        />
        <Tile
          label="Fleet adoption"
          value={summary.adoption ? `${summary.adoption.pct}%` : "—"}
          sub={summary.adoption ? `${summary.adoption.strong}/${summary.adoption.measured} repo·practice pairs` : "no scored repos yet"}
          color={summary.adoption ? READING_HUE : undefined}
        />
        <Tile
          label="Could adopt"
          value={summary.couldAdopt.repos}
          sub={`repos below the bar on ${summary.couldAdopt.practices} practice${summary.couldAdopt.practices === 1 ? "" : "s"}`}
        />
        {/* The starter-PR projection is OPTIONAL (attached only to practices actually applied here) —
            with none, this em-dashes rather than reporting a 0 that reads as "tried, nothing landed". */}
        <Tile
          label="PRs in flight"
          value={roll ? roll.open : "—"}
          sub={
            roll
              ? `${roll.merged} landed${roll.lift != null ? ` · +${roll.lift} avg lift` : ""}`
              : "no starter PRs opened yet"
          }
          color={roll && roll.open > 0 ? READING_HUE : undefined}
        />
      </div>

      <PracticesView
        slug={slug}
        initialPlaybooks={playbooks ?? []}
        practices={practices ?? []}
        adoption={adoption}
        dimOptions={dimOptions}
        repoOptions={repoOptions}
      />
    </div>
  );
}
