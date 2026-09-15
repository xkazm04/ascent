"use client";

// One subject, in depth: where it sits in the registry's taxonomy, what it triggers on, the laws it
// cites, the golden path's real path in the registry repo, and how every swept repo stands against
// it. The modal is the drill-down the old ledger refused to have; it stays a READER — the registry
// is the source of truth, this is its mirror.

import Link from "next/link";
import { Kicker, Modal, ModalBody, ModalHeader } from "@/components/ui";
import type { KnowledgeSubject, KnowledgeView } from "@/lib/org/knowledge-shape";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { isSurfaceShowcased } from "@/lib/org/surface-catalog";
import { CellButton, StageChip } from "./KnowledgeShared";
import { KnowledgeSubjectImpact } from "./KnowledgeSubjectImpact";
import { STATE_LABEL, columnRepos, indexCells, readSignal } from "./knowledgeModel";

export function KnowledgeSubjectDetail({
  view,
  slug,
  subject,
  registryUrl,
  pickedRepo,
  picked,
  onClose,
  onPick,
}: {
  view: KnowledgeView;
  /** Org slug — the "Open showcase" link into the UI surfaces tab needs it. */
  slug: string;
  subject: KnowledgeSubject | null;
  registryUrl: string | null;
  pickedRepo: string | null;
  picked: string[];
  onClose: () => void;
  onPick: (repositoryId: string, subject: string) => void;
}) {
  const open = !!subject;
  const cells = indexCells(view.cells);
  const signal = subject ? view.signals.find((s) => s.subjectSlug === subject.slug && s.bundle === subject.bundle) ?? null : null;
  const path = subject ? [subject.bundle, subject.category, subject.subcategory].filter(Boolean).join(" / ") : "";

  return (
    <Modal open={open} onClose={onClose} ariaLabel={subject ? `Subject ${subject.slug}` : "Subject"} size="reading">
      {subject ? (
        <>
          <ModalHeader kicker={path} title={subject.slug} context={`${subject.techniqueCount} techniques · ${subject.status ?? "status unknown"}`} />
          <ModalBody className="space-y-5">
            <section className="space-y-1.5">
              <Kicker tone="muted">Consulted when</Kicker>
              {subject.useWhen.length ? (
                <ul className="space-y-1 type-body-sm text-slate-300">
                  {subject.useWhen.slice(0, 6).map((u) => (
                    <li key={u} className="flex gap-2">
                      <span className="text-slate-600">›</span>
                      <span>{u}</span>
                    </li>
                  ))}
                  {subject.useWhen.length > 6 ? <li className="type-caption text-slate-500">+{subject.useWhen.length - 6} more triggers</li> : null}
                </ul>
              ) : (
                <p className="type-body-sm text-slate-500">No triggers mirrored — this subject can be read, not routed to.</p>
              )}
            </section>

            <section className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div className="space-y-1">
                <Kicker tone="muted">Laws cited</Kicker>
                <p className="type-mono-sm text-slate-400">{subject.laws.length ? subject.laws.join(" · ") : "—"}</p>
              </div>
              <div className="space-y-1">
                <Kicker tone="muted">Demand</Kicker>
                <p className="type-mono-sm text-slate-400" title="consults / deviations reported by the signals lane; — = no contributor reported it">
                  {readSignal(signal)}
                </p>
              </div>
            </section>

            <KnowledgeSubjectImpact view={view} subject={subject} cells={cells} />

            <section className="space-y-2">
              <Kicker tone="muted">Fleet standing</Kicker>
              <ul className="divide-y divide-divider rounded-xl border border-divider">
                {columnRepos(view.repos).map((r) => {
                  const cell = cells.get(subject.slug, r.repositoryId);
                  if (!cell) return null;
                  return (
                    <li key={r.repositoryId} className="flex items-center gap-3 px-3 py-2">
                      <CellButton
                        cell={cell}
                        repo={r.fullName}
                        picked={pickedRepo === r.repositoryId && picked.includes(subject.slug)}
                        onPick={() => onPick(r.repositoryId, subject.slug)}
                      />
                      <span className="min-w-0 flex-1 truncate type-mono-sm text-slate-200">{r.fullName}</span>
                      <span className="type-caption text-slate-500">
                        {STATE_LABEL[cell.state]}
                        {cell.stale ? " · stale" : ""}
                        {cell.contexts ? ` · ${cell.contexts} ctx` : ""}
                      </span>
                      <StageChip stage={r.stage} />
                    </li>
                  );
                })}
              </ul>
              {/* An instruction the reader must follow to compose — it stays. The second half
                  ("evidence is in each cell's title") described an affordance that already ships:
                  CellButton puts the map's file:line evidence in its `title`. */}
              <p className="type-caption text-slate-600">Pick a cell to add this subject to that repo&rsquo;s conform brief.</p>
            </section>

            <section className="flex flex-wrap items-baseline justify-between gap-2 border-t border-divider pt-4">
              <span className="type-caption text-slate-500">{subject.file}</span>
              {/* A ui-surfaces subject with a repo-shipped showcase deep-links into the UI surfaces tab
                  (a full tab switch — the other tab-scoped params are cleared, `subject` is re-set). */}
              {isSurfaceShowcased(subject.slug) ? (
                <Link
                  className="focus-ring type-mono-sm text-accent hover:text-accent-soft"
                  href={buildUrl(slug, { tab: "surfaces", ...clearedTabScopedParams(), subject: subject.slug }, "")}
                  data-open-showcase={subject.slug}
                >
                  Open showcase →
                </Link>
              ) : null}
              {registryUrl ? (
                <a
                  className="focus-ring type-mono-sm text-accent hover:text-accent-soft"
                  href={`${registryUrl}/blob/main/${subject.file}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open golden path ↗
                </a>
              ) : null}
            </section>
          </ModalBody>
        </>
      ) : null}
    </Modal>
  );
}
