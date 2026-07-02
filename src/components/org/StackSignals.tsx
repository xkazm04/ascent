// Computed callouts under the tech-stacks matrix — turns the grid into next steps instead of a
// read-only display: leader vs laggard, the single weakest stack×dimension cell, the dimension that
// varies most across stacks, and scan-coverage gaps. Pure derivation from the same summaries the
// matrix renders (no extra queries); every signal carries a follow-up link. Server-safe.

import Link from "next/link";
import type { ReactNode } from "react";
import type { SegmentSummary } from "@/lib/db";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";

const dimShort = (id: string) => DIMENSION_SHORT[id as keyof typeof DIMENSION_SHORT] ?? id;

function Score({ v }: { v: number }) {
  return (
    <span className="font-mono tabular-nums" style={{ color: scoreHex(v) }}>
      {v}
    </span>
  );
}

function Name({ children }: { children: ReactNode }) {
  return <span className="font-medium text-slate-200">{children}</span>;
}

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap font-mono text-sm text-accent transition hover:text-white">
      {children}
    </Link>
  );
}

/** Derive the signal list — split from the component so the "which callouts fire" logic stays one
 *  screenful. Only stacks with at least one scanned repo carry score signals; coverage looks at all. */
function buildSignals(org: string, stacks: SegmentSummary[]): { key: string; node: ReactNode }[] {
  const items: { key: string; node: ReactNode }[] = [];
  const scored = stacks.filter((s) => s.id && s.scannedCount > 0);

  // Leader vs laggard — who to copy from, who needs the attention. Links straight into the compare.
  if (scored.length >= 2) {
    const ranked = [...scored].sort((x, y) => y.avgOverall - x.avgOverall);
    const lead = ranked[0]!;
    const lag = ranked[ranked.length - 1]!;
    if (lead.avgOverall !== lag.avgOverall) {
      items.push({
        key: "leader",
        node: (
          <>
            <Name>{lead.name}</Name> leads at <Score v={lead.avgOverall} />; <Name>{lag.name}</Name> trails{" "}
            {lead.avgOverall - lag.avgOverall} pts behind at <Score v={lag.avgOverall} />.{" "}
            <Go href={`/org/${org}/tech-stacks?a=${encodeURIComponent(lag.id!)}&b=${encodeURIComponent(lead.id!)}#compare`}>
              compare →
            </Go>
          </>
        ),
      });
    }
  }

  // The weakest cell in the whole matrix — the most concrete place to start.
  let worst: { s: SegmentSummary; dimId: string; avg: number } | null = null;
  for (const s of scored) {
    for (const d of s.dimAverages) {
      if (!worst || d.avg < worst.avg) worst = { s, dimId: d.dimId, avg: d.avg };
    }
  }
  if (worst) {
    items.push({
      key: "worst-cell",
      node: (
        <>
          Weakest cell: <Name>{dimShort(worst.dimId)}</Name> in <Name>{worst.s.name}</Name> at <Score v={worst.avg} /> — start
          fixes there.{" "}
          <Go href={`/org/${org}/repositories?stack=${encodeURIComponent(worst.s.id!)}`}>view repos →</Go>
        </>
      ),
    });
  }

  // The dimension with the widest spread across stacks — where practice hasn't traveled between teams.
  let spread: { dimId: string; min: { s: SegmentSummary; avg: number }; max: { s: SegmentSummary; avg: number } } | null = null;
  const byDim = new Map<string, { s: SegmentSummary; avg: number }[]>();
  for (const s of scored) {
    for (const d of s.dimAverages) {
      const list = byDim.get(d.dimId) ?? [];
      list.push({ s, avg: d.avg });
      byDim.set(d.dimId, list);
    }
  }
  for (const [dimId, entries] of byDim) {
    if (entries.length < 2) continue;
    const min = entries.reduce((m, e) => (e.avg < m.avg ? e : m));
    const max = entries.reduce((m, e) => (e.avg > m.avg ? e : m));
    if (!spread || max.avg - min.avg > spread.max.avg - spread.min.avg) spread = { dimId, min, max };
  }
  if (spread && spread.max.avg - spread.min.avg > 0) {
    items.push({
      key: "spread",
      node: (
        <>
          <Name>{dimShort(spread.dimId)}</Name> varies most by stack — <Score v={spread.min.avg} /> in{" "}
          <Name>{spread.min.s.name}</Name> vs <Score v={spread.max.avg} /> in <Name>{spread.max.s.name}</Name> (
          {spread.max.avg - spread.min.avg}-pt spread); {spread.max.s.name}&apos;s playbook likely transfers.{" "}
          <Go
            href={`/org/${org}/tech-stacks?a=${encodeURIComponent(spread.min.s.id!)}&b=${encodeURIComponent(spread.max.s.id!)}#compare`}
          >
            compare →
          </Go>
        </>
      ),
    });
  }

  // Coverage gaps — averages only speak for scanned repos, so name the thinnest stack.
  const gaps = stacks.filter((s) => s.id && s.scannedCount < s.repoCount);
  if (gaps.length > 0) {
    const thinnest = gaps.reduce((m, s) => (s.scannedCount / s.repoCount < m.scannedCount / m.repoCount ? s : m));
    items.push({
      key: "coverage",
      node: (
        <>
          {gaps.length === 1 ? (
            <><Name>{thinnest.name}</Name> has unscanned repos</>
          ) : (
            <>{gaps.length} stacks have unscanned repos — thinnest is <Name>{thinnest.name}</Name></>
          )}{" "}
          ({thinnest.scannedCount}/{thinnest.repoCount} scanned); averages firm up as coverage grows.{" "}
          <Go href={`/org/${org}/repositories?stack=${encodeURIComponent(thinnest.id!)}`}>scan →</Go>
        </>
      ),
    });
  }

  return items;
}

export function StackSignals({ org, stacks }: { org: string; stacks: SegmentSummary[] }) {
  const items = buildSignals(org, stacks);
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {items.map((it) => (
        <li key={it.key} className="flex items-baseline gap-2 text-sm text-slate-400">
          <span aria-hidden className="text-slate-600">▸</span>
          <span>{it.node}</span>
        </li>
      ))}
    </ul>
  );
}
