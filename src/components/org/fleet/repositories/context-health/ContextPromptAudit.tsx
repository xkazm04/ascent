// VARIANT 2 — "Prompt audit".
//
// METAPHOR: a copy-edit desk. If the codebase is the prompt, then AGENTS.md is published prose and
// deserves to be marked up like prose — graded, stamped with its provenance, and split into signal
// vs noise. The surface is deliberately EDITORIAL (Dateline masthead, a running verdict line,
// entries not table rows) because the argument it makes is a judgement, not a measurement.
//
// WHY IT DIFFERS from the other variants: Half-life sorts by urgency and refuses to grade;
// Map-vs-territory is spatial and fleet-shaped. This one is the only variant that says out loud
// "this file is bad, and here is the specific way it is bad" — the presence-vs-quality argument at
// its most confrontational. The provenance stamp is the point: an LLM-generated CLAUDE.md is scored
// as a liability, which no presence checker on the market can do.

import Link from "next/link";
import { Dateline, Kicker, Surface } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER, InlineEmpty } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { fleetContextSummary, USABLE_QUALITY, type RepoContextHealth } from "./contextHealthMock";
import { AuditEntry, auditVerdict } from "./AuditEntry";

export function ContextPromptAudit({ slug, rows }: { slug: string; rows: RepoContextHealth[] }) {
  const s = fleetContextSummary(rows);
  // Worst first — an audit leads with what failed, not with what passed.
  const ordered = [...rows].sort((a, b) => a.quality - b.quality || b.commitsPerWeek - a.commitsPerWeek);
  const hollow = rows.filter((r) => r.present && r.quality < USABLE_QUALITY);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Prompt audit"
        description="Your codebase is the prompt. These are the files an agent reads first, marked up the way you would mark up published prose."
        right={
          <Link
            href={orgTabHref(slug, "practices")}
            className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Apply a context practice →
          </Link>
        }
      />

      <Surface className="p-5">
        <Dateline
          left={`Context desk · ${s.repos} repositories`}
          right={`Bar: quality ≥ ${USABLE_QUALITY}`}
        />
        <p className="mt-4 text-base text-slate-200">{auditVerdict(s.withContext, s.withUsableContext, s.generated)}</p>
        <p className="mt-2 text-sm text-slate-400">
          Every competing readiness checker stops at the first column below. The other three are why a
          fleet with 100% presence can still be feeding its agents fiction.
        </p>
        <div className={`${TILE_LEDGER} mt-4 sm:grid-cols-2 lg:grid-cols-4`}>
          <Tile label="Has context" value={`${s.withContext}/${s.repos}`} sub="what presence checks measure" />
          <Tile
            label="Clears the bar"
            value={`${s.withUsableContext}/${s.repos}`}
            sub="current · specific · covering"
            color={scoreHex(s.repos ? (s.withUsableContext / s.repos) * 100 : 0)}
          />
          <Tile label="Present but hollow" value={hollow.length} sub="a false sense of readiness" color={hollow.length ? scoreHex(35) : undefined} />
          <Tile
            label="Fleet context quality"
            value={s.avgQuality}
            sub="mean 0–100 across all repos"
            color={scoreHex(s.avgQuality)}
          />
        </div>
      </Surface>

      <div>
        <Kicker tone="muted">Entries · worst first</Kicker>
        {ordered.length === 0 ? (
          <InlineEmpty>No repositories in scope.</InlineEmpty>
        ) : (
          <div className={`${TILE_LEDGER} mt-3`}>
            {ordered.slice(0, 10).map((r) => (
              <AuditEntry key={r.fullName} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
