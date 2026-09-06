"use client";

// edge-management: the economy controls. Which kinds earn ink (one dimension at a time by default,
// the union as an explicit mode), focus-context on or off, the fat hit stroke's width, and the test
// of the whole economy — "what does this connect to?" answered for the focused node in any view.

import { EDGE_KINDS, type EdgeKind, type Graph } from "./fixtures";
import type { EdgeSettings, RenderList } from "./renderList";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";

export function EdgePanel({ graph, settings, onSettings, list, focus, selectedEdge }: { graph: Graph; settings: EdgeSettings; onSettings: (s: EdgeSettings) => void; list: RenderList; focus: string | null; selectedEdge: string | null }) {
  const toggleKind = (k: EdgeKind) => {
    const kinds = new Set(settings.kinds);
    if (kinds.has(k)) kinds.delete(k); else kinds.add(k);
    onSettings({ ...settings, kinds });
  };
  const lit = list.edges.filter((e) => e.lit).length;
  const node = focus ? graph.byId.get(focus) : null;
  const outs = focus ? (graph.out.get(focus) ?? []).map((id) => graph.edgeById.get(id)).filter((e) => e && settings.kinds.has(e.kind)) : [];
  const ins = focus ? (graph.inc.get(focus) ?? []).map((id) => graph.edgeById.get(id)).filter((e) => e && settings.kinds.has(e.kind)) : [];
  const sel = selectedEdge ? graph.edgeById.get(selectedEdge) : null;
  return (
    <Region technique="edge-management" title="Which edges deserve ink" note="Anchors from the one geometry function; focus-context recedes the rest; a one-pixel edge is pressed through an eight-pixel promise.">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Edge kinds drawn">
        {EDGE_KINDS.map((k) => (
          <button key={k} type="button" className={settings.kinds.has(k) ? BTN_ON : BTN} aria-pressed={settings.kinds.has(k)} onClick={() => toggleKind(k)} data-kind={k}>
            {k}
          </button>
        ))}
        <button type="button" className={settings.focusContext ? BTN_ON : BTN} aria-pressed={settings.focusContext} onClick={() => onSettings({ ...settings, focusContext: !settings.focusContext })} data-focus-context>
          focus-context
        </button>
      </div>
      <label className="mt-3 block">
        <span className="type-caption text-slate-400">hit stroke: {settings.hitWidth}px (screen)</span>
        <input type="range" min={1} max={24} value={settings.hitWidth} onChange={(e) => onSettings({ ...settings, hitWidth: Number(e.target.value) })} className="mt-1 w-full accent-[var(--color-accent)]" aria-label="Edge hit stroke width" />
      </label>
      <div className="mt-3 space-y-1">
        <Readout label="drawn · full ink" value={<span data-lit={lit}>{`${list.edges.length} · ${lit}`}</span>} />
        <Readout label="selected edge" value={sel ? `${graph.byId.get(sel.from)?.name} → ${graph.byId.get(sel.to)?.name} (${sel.kind}, w${sel.weight})` : "click a path"} />
      </div>
      <div className="mt-3" data-connects-to={focus ?? undefined}>
        <p className="type-caption text-slate-400">{node ? `${node.name} connects to:` : "hover or focus a node: what does it connect to?"}</p>
        {node ? (
          <ul className="mt-1 space-y-0.5 type-caption text-slate-300">
            {outs.slice(0, 5).map((e) => e && <li key={e.id}>→ {graph.byId.get(e.to)?.name} <span className="text-slate-600">{e.kind}</span></li>)}
            {ins.slice(0, 5).map((e) => e && <li key={e.id}>← {graph.byId.get(e.from)?.name} <span className="text-slate-600">{e.kind}</span></li>)}
            {outs.length + ins.length === 0 ? <li className="text-slate-600">nothing in the drawn kinds</li> : null}
          </ul>
        ) : null}
      </div>
    </Region>
  );
}
