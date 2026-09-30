"use client";

// Dead ends other repos already claimed. Claimed is partial, verified is not measured. A row opens
// the note. The date stays the repo's own text.
import { useState } from "react";
import { Caption, CellMark, EscBack, Frame, HairlineList, LevelNav, ListRow, Panel, SectionHead } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import type { RepoMemoryEntryRow } from "@/lib/db/repo-memory";
import { groupByRepo } from "./RepoMemoryDeadEnds";
import { excerpt } from "./memoryView";

export function RepoMemoryDeadEndsV2({ rows }: { rows: RepoMemoryEntryRow[] }) {
  const [openId, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const groups = groupByRepo(rows);
  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;

  return (
    <Frame aria-label="Dead ends other repos already hit">
      <SectionHead
        eyebrow="Dead ends"
        title="Failed approaches"
        named="other repos already hit"
        lede="These are claims from a repository, not verified facts. Nothing here has been judged."
      />
      <div className="mt-4 flex flex-wrap gap-4">
        <CellMark state="partial">claimed</CellMark>
        <CellMark state="unmeasured">verified, not measured</CellMark>
        <Caption>
          {rows.length} across {groups.length} repo{groups.length === 1 ? "" : "s"}
        </Caption>
      </div>
      {openId ? (
        <DeadEndScene row={open} onBack={() => setOpen(null)} />
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map((g) => (
            <div key={g.repo}>
              <Caption>
                {g.repo}, {g.rows.length} dead end{g.rows.length === 1 ? "" : "s"}
              </Caption>
              <HairlineList className="mt-2">
                {g.rows.map((r) => (
                  <ListRow
                    key={r.id}
                    onPress={() => setOpen(r.id)}
                    title={r.path}
                    detail={`${r.entryDate ?? "undated"}${r.scope ? `, scope ${r.scope}` : ""}`}
                  />
                ))}
              </HairlineList>
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}

function DeadEndScene({ row, onBack }: { row: RepoMemoryEntryRow | null; onBack: () => void }) {
  return (
    <div className="mt-4">
      <EscBack onBack={onBack} />
      <LevelNav
        trail={[{ label: "Dead ends" }, { label: row ? excerpt(row.path, 48) : "Not in this list" }]}
        back={{ label: "All dead ends", onClick: onBack }}
      />
      {!row ? (
        <p className="mt-4 type-body text-slate-400">This note is no longer in the list.</p>
      ) : (
        <Panel pad="sm" className="mt-4" aria-label="Dead-end note">
          <p className="type-body-sm text-slate-200">{row.repoFullName}</p>
          <p className="mt-1 type-caption text-slate-400" title={row.path}>
            {row.path}
          </p>
          <p className="mt-1 type-caption text-slate-400">{row.entryDate ?? "undated"}</p>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap type-body-sm text-slate-200">{row.body}</pre>
          {row.scope && <p className="mt-2 type-caption text-slate-400">scope: {row.scope}</p>}
          <div className="mt-3">
            <CopyForLlm text={row.body} label="Copy" ariaLabel={`Copy the dead-end note from ${row.path}`} />
          </div>
        </Panel>
      )}
    </div>
  );
}
