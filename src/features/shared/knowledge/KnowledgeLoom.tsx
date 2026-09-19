"use client";

// The Knowledge base tab's live surface — **the Loom** (prototype round of 2026-09-05; Atlas and
// Board were the other two directions and lost).
//
// Metaphor: a loom. Warp = every subject of the bundle, in the taxonomy's own order and grouping;
// weft = every mapped repo, worst first. Each crossing is one cell with one of eleven states, and
// picking cells threads them straight into the dispatch composer docked beneath. Use case 3 (the
// domain matrix) is the surface; use case 1 (the registry's structure) is the row labels; use case 2
// (mapping a project into the registry) is the composer and the "off the loom" strip.
//
// Why matrix-first: "which projects consume which topics of this domain" is a comparison across
// uniform attributes — a table's job, per the registry's `table` golden path: chrome renders
// unconditionally, only the body is data, and sweep age is the instrument's calibration date.

import { useState } from "react";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeComposer } from "./KnowledgeComposer";
import { KnowledgeCoverage } from "./KnowledgeCoverage";
import { KnowledgeLoomGrid } from "./KnowledgeLoomGrid";
import { DomainPicker, SweepStrip } from "./KnowledgeShared";
import { StateLegend } from "./KnowledgeStateLegend";
import { KnowledgeSubjectDetail } from "./KnowledgeSubjectDetail";
import { STAGE_ACTION, buildTree, columnRepos, indexCells, subjectsOf, unmappedRepos } from "./knowledgeModel";
import { useKnowledgeActions } from "./useKnowledgeActions";
import { useKnowledgeSelection } from "./useKnowledgeSelection";

export function KnowledgeLoom({
  view,
  slug,
  initialDomain = null,
  initialSubject = null,
  preview = false,
}: {
  view: KnowledgeView;
  slug: string;
  initialDomain?: string | null;
  initialSubject?: string | null;
  /** The dev-only shaped fleet: no URL sync, every action inert. */
  preview?: boolean;
}) {
  const api = useKnowledgeSelection(view, { slug, initialDomain, initialSubject, syncUrl: !preview });
  const actions = useKnowledgeActions(slug, preview);
  const { sel, domain, subjectRow } = api;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!domain) return null;
  const subjects = subjectsOf(view, domain.name);
  const tree = buildTree(domain.taxonomy, subjects);
  const cells = indexCells(view.cells);
  const cols = columnRepos(view.repos);
  const off = unmappedRepos(view.repos);
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DomainPicker domains={view.domains} active={domain.name} onPick={api.setDomain} />
        {/* Unit and window only. "N of M golden paths mirrored" is the coverage matrix's Mirrored
            axis now — a share is a shape, not a sentence. */}
        <span className="type-caption text-slate-500">
          {cols.length} repo{cols.length === 1 ? "" : "s"} on the map
          {view.sweep.truncated ? " · pair list truncated" : ""}
        </span>
      </div>

      {/* First sight is graphical: coverage, routability and judged share, per bundle. */}
      <KnowledgeCoverage view={view} />

      <SweepStrip view={view} onSweep={() => actions.sweep()} pending={actions.state.pending === "sweep"} />

      {subjects.length === 0 ? (
        <p className="rounded-2xl border border-divider bg-surface/40 px-5 py-4 type-body-sm text-slate-400">
          The registry is indexed but no subject rows are mirrored for <span className="font-mono text-slate-200">{domain.name}</span> — the last
          index pass predates the subject mirror. Re-index the registry from the Registry tab and the loom fills in.
        </p>
      ) : null}

      {off.length ? (
        <div className="flex flex-wrap items-center gap-2 type-caption text-slate-500">
          <span>Off the loom:</span>
          {off.map((r) => (
            <button
              key={r.repositoryId}
              type="button"
              className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2 py-1 hover:border-accent ${sel.repo === r.repositoryId ? "border-accent" : "border-divider"}`}
              onClick={() => api.focusRepo(sel.repo === r.repositoryId ? null : r.repositoryId)}
              aria-pressed={sel.repo === r.repositoryId}
            >
              <span className="type-mono-sm text-slate-300">{r.fullName.split("/").pop()}</span>
              <span className="text-accent">{STAGE_ACTION[r.stage]} →</span>
            </button>
          ))}
        </div>
      ) : null}

      {subjects.length ? (
        <KnowledgeLoomGrid view={view} domain={domain} tree={tree} cols={cols} cells={cells} api={api} collapsed={collapsed} onToggle={toggle} />
      ) : null}
      <StateLegend />

      <KnowledgeComposer view={view} api={api} actions={actions} className="lg:sticky lg:bottom-3" />

      <KnowledgeSubjectDetail
        view={view}
        slug={slug}
        subject={subjectRow}
        registryUrl={view.registry?.url ?? null}
        pickedRepo={sel.repo}
        picked={sel.picked}
        onClose={() => api.focusSubject(null)}
        onPick={api.toggleCell}
      />
    </div>
  );
}
