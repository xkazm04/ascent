"use client";

// canvas-accessibility: the graph as text. One announcer the keyboard hook speaks through, the
// spatial/topological switch, a jump palette (type a name, land on it, camera framed), the focused
// node's neighbourhood as an ordered list, and the key legend. The canvas and this list are two
// renderings of one model, so neither can go stale.

import { useState } from "react";
import { Field, TextInput } from "@/components/ui";
import type { Graph } from "./fixtures";
import { BTN, BTN_ON, Region } from "./sceneParts";
import { describe, type NavMode, type Pick } from "./useKeyboardNav";

const KEYS: [string, string][] = [
  ["Tab", "reaches the canvas once — never once per node"],
  ["← → ↑ ↓", "move the cursor (spatial: nearest that way; topological: targets / sources / siblings)"],
  ["Enter · Shift+Enter", "select · toggle (focus is not selection)"],
  ["Shift+arrows · Alt", "nudge selection 8 · 40 units — one transaction per key"],
  ["c · arrows · Enter", "connect: pick travels eligible targets only; Escape cancels"],
  ["+ − 0 · Home", "zoom in, out, fit all · first node"],
];

export function A11yPanel({ graph, cursor, selected, mode, onMode, message, pick, onJump }: { graph: Graph; cursor: string | null; selected: ReadonlySet<string>; mode: NavMode; onMode: (m: NavMode) => void; message: string; pick: Pick | null; onJump: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q ? graph.nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const node = cursor ? graph.byId.get(cursor) : null;
  const outs = cursor ? (graph.out.get(cursor) ?? []).map((id) => graph.edgeById.get(id)?.to ?? "") : [];
  const ins = cursor ? (graph.inc.get(cursor) ?? []).map((id) => graph.edgeById.get(id)?.from ?? "") : [];
  return (
    <Region technique="canvas-accessibility" title="The graph, not the geometry" note="One focusable region, a roving cursor inside it, every pointer act with a key path, and an outline that is the same model document-shaped.">
      <div role="status" aria-live="polite" aria-atomic="true" className="min-h-[1.5rem] rounded-md border border-divider px-2 py-1 type-caption text-slate-300" data-announcer>
        {message}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Navigation axis">
        {(["spatial", "topological"] as const).map((m) => (
          <button key={m} type="button" className={mode === m ? BTN_ON : BTN} aria-pressed={mode === m} onClick={() => onMode(m)} data-nav-mode={m}>
            {m}
          </button>
        ))}
        {pick ? <span className="type-caption text-accent-soft" data-pick-count={pick.candidates.length}>connect pick: {pick.index + 1}/{pick.candidates.length} eligible</span> : null}
      </div>
      <Field label="Jump to" className="mt-3">
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="type a repository name" />
      </Field>
      {matches.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1" aria-label="Matches">
          {matches.map((n) => (
            <li key={n.id}>
              <button type="button" className={BTN} onClick={() => { onJump(n.id); setQuery(""); }}>
                {n.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3" data-outline>
        <p className="type-caption text-slate-400">{node ? describe(graph, node.id, selected) : "no cursor yet — focus the canvas and press an arrow"}</p>
        {node ? (
          <ul className="mt-1 space-y-0.5 type-caption text-slate-300">
            {outs.slice(0, 4).map((id) => <li key={`o-${id}`}>→ {graph.byId.get(id)?.name}</li>)}
            {ins.slice(0, 4).map((id) => <li key={`i-${id}`}>← {graph.byId.get(id)?.name}</li>)}
          </ul>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 type-caption">
        {KEYS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-300">{k}</dt>
            <dd className="text-slate-500">{v}</dd>
          </div>
        ))}
      </dl>
    </Region>
  );
}
