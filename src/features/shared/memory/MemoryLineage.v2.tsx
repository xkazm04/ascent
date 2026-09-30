"use client";

// Earlier versions of a corrected memory. Same on-demand read as Altimeter. A predecessor is
// struck and marked superseded. Another author's private notes are counted, never listed.
import { useState } from "react";
import { CellMark, GhostAction } from "@/components/kit";
import type { MemoryRow } from "@/lib/db";

type Lineage = { lineage: MemoryRow[]; lineageHidden: number };

const plural = (n: number) => `${n} earlier version${n === 1 ? "" : "s"}`;

export function MemoryLineageV2({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Lineage | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data) return;
    setFailed(false);
    try {
      const res = await fetch(`/api/org/memory/${id}?lineage=1`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Partial<Lineage>;
      setData({ lineage: body.lineage ?? [], lineageHidden: body.lineageHidden ?? 0 });
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="mt-4 border-t border-divider pt-3">
      <GhostAction onClick={() => void toggle()}>{open ? "Hide earlier versions" : "Show earlier versions"}</GhostAction>
      {open && (
        <div className="mt-3">
          {failed ? (
            <p className="type-body-sm text-slate-200">
              <span aria-hidden>! </span>Couldn&apos;t load the earlier versions.
            </p>
          ) : !data ? (
            <p className="type-body-sm text-slate-400">Loading…</p>
          ) : (
            <>
              {data.lineage.length === 0 && data.lineageHidden === 0 && (
                <p className="type-body-sm text-slate-400">
                  No earlier version is on record. An in-place edit also raises the version number.
                </p>
              )}
              <ol className="space-y-3">
                {data.lineage.map((r) => (
                  <li key={r.id}>
                    <CellMark state="missing">superseded</CellMark>
                    <p className="mt-1 line-clamp-3 type-body-sm whitespace-pre-wrap text-slate-400 line-through">{r.content}</p>
                    <p className="type-caption text-slate-400">
                      v{r.version}, by {r.createdBy ?? "unknown"}, {r.updatedAt.slice(0, 10)}
                    </p>
                  </li>
                ))}
              </ol>
              {data.lineageHidden > 0 && (
                <p className="mt-2 type-body-sm text-slate-400">
                  {plural(data.lineageHidden)} you cannot see:{" "}
                  {data.lineageHidden === 1 ? "another author's private note." : "other authors' private notes."}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
