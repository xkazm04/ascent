"use client";

// primitive-level-a11y: the worklist is built from the scene's own primitive catalog — a native
// checkbox wrapped by its label, a native-button switch with `role="switch"` + `aria-checked`, an
// icon-only button whose name is a REQUIRED prop, a plain button for the visible action. Rows are not
// clickable: secondary actions are siblings, not descendants (one interactive ancestor per gesture).
// Deleting the focused row hands focus to the nearest surviving row, never to <body>. The audit table
// underneath is the catalog inventory: role, name, keys, focus, announced state, per primitive.

import { useRef, useState } from "react";
import { STATUS_GLYPH, STATUS_TONE, type Row } from "./fixtures";
import { BTN, IconButton, Region, Switch } from "./sceneParts";

const CATALOG = [
  { primitive: "IconButton", wraps: "<button>", name: "required `label` prop (aria-label)", state: "disabled" },
  { primitive: "Switch", wraps: "<button role=switch>", name: "visible text, names the thing it controls", state: "aria-checked" },
  { primitive: "Watch", wraps: "<input type=checkbox> in <label>", name: "label content", state: "checked (native)" },
  { primitive: "Segment chip", wraps: "<button>", name: "visible text", state: "aria-pressed" },
] as const;

export function WorklistRegion({ rows, onDelete, onResolve, announce }: { rows: Row[]; onDelete: (id: string) => void; onResolve: (id: string) => void; announce: (t: string) => void }) {
  const [muted, setMuted] = useState(false);
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set());
  const tableRef = useRef<HTMLTableElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  const remove = (row: Row, i: number) => {
    const survivor = rows[i + 1] ?? rows[i - 1] ?? null;
    onDelete(row.id);
    announce(`Deleted ${row.title}.`);
    // Focus handoff, in the handler: the survivor is already mounted, the empty notice always is.
    if (survivor) tableRef.current?.querySelector<HTMLElement>(`[data-row-id="${survivor.id}"] button`)?.focus();
    else emptyRef.current?.focus();
  };
  const toggleWatch = (id: string) => setWatched((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <Region technique="primitive-level-a11y" title="Accessibility multiplies through primitives" note="Native first. The catalog carries the contract; the screen composes it without adding meaning outside it.">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Switch label="Mute digest" on={muted} onToggle={() => setMuted((m) => !m)} />
        <span className="type-caption text-slate-500">{watched.size} watched · {rows.length} shown</span>
      </div>
      <table ref={tableRef} className="w-full type-caption">
        <caption className="sr-only">Follow-ups in the selected segment</caption>
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">watch</th>
            <th className="font-normal">follow-up</th>
            <th className="font-normal">status</th>
            <th className="font-normal">age</th>
            <th className="font-normal">actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} data-row-id={r.id} className="border-t border-divider align-top text-slate-300">
              <td className="py-1.5">
                <label className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={watched.has(r.id)} onChange={() => toggleWatch(r.id)} className="focus-ring accent-[var(--color-accent)]" />
                  <span className="sr-only">Watch {r.title}</span>
                </label>
              </td>
              <td className="py-1.5">
                <span className="block text-slate-200">{r.title}</span>
                <span className="block text-slate-500">{r.repo}</span>
              </td>
              {/* Status: glyph + word beside the color — the structural carrier a forced palette keeps. */}
              <td className={`py-1.5 ${STATUS_TONE[r.status]}`}>
                <span aria-hidden>{STATUS_GLYPH[r.status]} </span>
                {r.status}
              </td>
              <td className="py-1.5 tabular-nums text-slate-400">{r.days}d</td>
              <td className="py-1.5">
                <div className="flex gap-1">
                  <button type="button" className={BTN} disabled={r.status === "done"} onClick={() => { onResolve(r.id); announce(`Resolved ${r.title}.`); }}>
                    resolve
                  </button>
                  <IconButton label={`Delete ${r.title}`} glyph="x" onClick={() => remove(r, i)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p ref={emptyRef} tabIndex={-1} className="focus-ring mt-1 type-caption text-slate-500" hidden={rows.length > 0}>
        No follow-ups in this segment. Focus landed here, not on the page body.
      </p>

      <table className="mt-3 w-full type-caption">
        <caption className="text-left type-caption text-slate-500">catalog audit — one row fixed repairs every consumer</caption>
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">primitive</th>
            <th className="font-normal">native carrier</th>
            <th className="font-normal">name from</th>
            <th className="font-normal">announced state</th>
          </tr>
        </thead>
        <tbody>
          {CATALOG.map((c) => (
            <tr key={c.primitive} className="border-t border-divider text-slate-300">
              <td className="py-1">{c.primitive}</td>
              <td className="py-1 text-slate-500">{c.wraps}</td>
              <td className="py-1">{c.name}</td>
              <td className="py-1 text-slate-500">{c.state}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 type-caption text-slate-500">Every control here has keys from its native element and focus from the shared `.focus-ring`. The row is not a click target, so no gesture has two interactive ancestors.</p>
    </Region>
  );
}
