"use client";

// Extracted from MemoryPanel — the memory table: one row per memory, expanding to a MemoryCard. Pure
// relocation (same markup, className strings and caption); the list/expansion state stays in MemoryPanel
// and is passed in as props. Keeps the orchestrator under the 300-LOC ceiling (AGENTS.md).

import { Fragment } from "react";
import { OrgTable } from "@/components/org/shared/ui";
import { MemoryCard } from "@/components/org/library/memory/MemoryCard";
import { confidenceLabel, memoryKindLabel } from "@/lib/org/memory-kinds";
import type { MemoryRow } from "@/lib/db";

export function MemoryList({
  memories,
  expanded,
  setExpanded,
  viewerLogin,
  isAdmin,
  onArchive,
}: {
  memories: MemoryRow[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  viewerLogin: string | null;
  isAdmin: boolean;
  onArchive: (id: string) => void;
}) {
  return (
    <OrgTable
      caption="Org memories: content, kind, namespace, trust and recalls"
      minWidth={640}
      head={
        <tr>
          <th className="px-3 py-2 text-left">Memory</th>
          <th className="px-3 py-2 text-left">Kind</th>
          <th className="px-3 py-2 text-left">Namespace</th>
          <th className="px-3 py-2 text-right">Trust</th>
          <th className="px-3 py-2 text-right">Recalls</th>
        </tr>
      }
    >
      {memories.map((m) => {
        const open = expanded === m.id;
        return (
          <Fragment key={m.id}>
            <tr onClick={() => setExpanded(open ? null : m.id)} className="cursor-pointer">
              {/* max-w-0 + truncate: the content column absorbs the remaining width and clips instead of
                  forcing the table to overflow on a long memory. */}
              <td className="max-w-0 px-3 py-2">
                <span className="block truncate text-slate-200">{m.content}</span>
              </td>
              <td className="px-3 py-2">
                <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                  {memoryKindLabel(m.kind)}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{m.namespace || "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                {confidenceLabel(m.confidence)}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{m.accessCount}</td>
            </tr>
            {open && (
              <tr>
                <td colSpan={5} className="px-3 pb-3">
                  <MemoryCard
                    memory={m}
                    viewerLogin={viewerLogin}
                    canArchive={isAdmin}
                    onArchive={() => onArchive(m.id)}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </OrgTable>
  );
}
