"use client";

// What a corrected memory replaced: the history behind a card's v{n} badge. Read on demand from
// GET /api/org/memory/:id?lineage=1 (the supersededBy chain walked backwards within the viewer's
// visibility), so a closed card costs no request. Each earlier version wears the `superseded` mark
// (half opacity, struck through), the same vocabulary the check verdict and merge clusters use.
// Another author's private predecessors are counted, never listed: the reader learns history exists
// without reading someone else's scratch.

import { useState } from "react";
import { StateSwatch } from "@/components/org/viz";
import type { MemoryRow } from "@/lib/db";

type Lineage = { lineage: MemoryRow[]; lineageHidden: number };

const plural = (n: number) => `${n} earlier version${n === 1 ? "" : "s"}`;

export function MemoryLineage({ id }: { id: string }) {
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
    <div className="mt-3 border-t border-slate-800 pt-3">
      <button
        onClick={() => void toggle()}
        aria-expanded={open}
        className="type-mono-sm text-slate-500 transition hover:text-slate-300"
        title="What this memory replaced"
      >
        {open ? "Hide earlier versions" : "Show earlier versions"}
      </button>
      {open && (
        <div className="mt-2">
          {failed ? (
            <p className="type-caption text-orange-300">Couldn&apos;t load the earlier versions.</p>
          ) : !data ? (
            <p className="type-caption text-slate-500">Loading…</p>
          ) : (
            <>
              {data.lineage.length === 0 && data.lineageHidden === 0 && (
                <p className="type-caption text-slate-500">
                  No earlier version is on record. An in-place edit also raises the version number.
                </p>
              )}
              <ol className="space-y-2">
                {data.lineage.map((r) => (
                  <li key={r.id} data-state="superseded" className="flex items-start gap-2">
                    <StateSwatch state="superseded" size={11} className="mt-1 shrink-0" />
                    <div className="min-w-0 opacity-50">
                      <p className="line-clamp-3 type-caption whitespace-pre-wrap text-slate-300 line-through decoration-slate-500">
                        {r.content}
                      </p>
                      <p className="type-mono-sm text-slate-500">
                        v{r.version} · by {r.createdBy ?? "unknown"} · {r.updatedAt.slice(0, 10)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {data.lineageHidden > 0 && (
                <p className="mt-2 type-caption text-slate-500">
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
