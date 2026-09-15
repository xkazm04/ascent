"use client";

// command-surface: summon, type, enter. The corpus is the scene's ONE command registry (the action
// strip renders from the same list) plus a labelled, bounded repository section; matching is synchronous
// per keystroke, scored by shape with a floor, ties broken by the session ledger and then stable id.
// Enter runs the top hit; Escape leaves everything as it was.

import { useMemo, useState } from "react";
import { TextInput } from "@/components/ui";
import { rankItems, remember, type PaletteItem } from "./palette";
import type { FleetSearch } from "./useFleetSearch";
import { BTN, Readout, Region } from "./sceneParts";

const REPO_SECTION = 200;

export function PalettePanel({ s }: { s: FleetSearch }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [last, setLast] = useState<string | null>(null);

  // Destinations: the most recently updated repositories, a bounded, labelled corpus — never "everything, sometimes".
  const repoItems = useMemo<PaletteItem[]>(
    () => [...s.source].sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)).slice(0, REPO_SECTION).map((r) => ({ id: r.id, kind: "repository", label: `${r.owner}/${r.name}`, keywords: r.lang })),
    [s.source],
  );
  const items = useMemo<PaletteItem[]>(() => [...s.commands, ...repoItems], [s.commands, repoItems]);
  const ranked = useMemo(() => rankItems(items, q, recent), [items, q, recent]);
  const shown = ranked.shown.slice(0, 8);
  const pick = (id: string) => {
    const cmd = s.commands.find((c) => c.id === id);
    if (cmd) cmd.run();
    else s.setText(items.find((i) => i.id === id)?.label.split("/")[1] ?? "");
    setRecent((r) => remember(r, id));
    setLast(id);
    setOpen(false);
    setQ("");
    setCursor(0);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(shown.length - 1, c + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
    else if (e.key === "Enter" && shown[cursor]) (e.preventDefault(), pick(shown[cursor].item.id));
    else if (e.key === "Escape") (setOpen(false), setQ(""), setCursor(0));
  };

  return (
    <Region technique="command-surface" title="Three characters, then enter, blind" note="Initials outrank interior substrings; the floor rejects noise; history breaks ties and never overrides a match.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="search-palette">
          {open ? "close palette" : "open palette (⌘K)"}
        </button>
        <span className="type-caption text-slate-500">corpus: {s.commands.length} commands · {repoItems.length} most recently updated repositories</span>
      </div>
      {open ? (
        <div id="search-palette" className="mt-2 rounded-lg border border-divider bg-surface/40 p-2" role="dialog" aria-label="Command palette">
          <TextInput
            value={q}
            onChange={(e) => (setQ(e.target.value), setCursor(0))}
            onKeyDown={onKey}
            placeholder="commands and repositories — type to narrow, ↑↓ to move, enter to run"
            aria-label="Palette query"
            autoFocus
            autoComplete="off"
          />
          <ul className="mt-2 space-y-0.5" role="listbox" aria-label="Palette results" data-palette-list>
            {shown.map(({ item, match }, i) => (
              <li key={item.id} role="option" aria-selected={i === cursor} data-palette-item={item.id}>
                <button type="button" className={`focus-ring flex w-full items-center justify-between rounded px-2 py-1 text-left type-caption ${i === cursor ? "bg-accent/10 text-accent-soft" : "text-slate-300"}`} onMouseEnter={() => setCursor(i)} onClick={() => pick(item.id)}>
                  <span>
                    {[...item.label].map((ch, k) => (match.positions.includes(k) ? <mark key={k} className="bg-transparent text-accent-soft underline">{ch}</mark> : <span key={k}>{ch}</span>))}
                  </span>
                  <span className="text-slate-600">
                    {item.kind}
                    {recent.includes(item.id) ? " · recent" : ""}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-2 type-caption text-slate-500">Nothing above the floor. A palette full of noise costs more trust than a miss.</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 space-y-1">
        <Readout label="candidates · shown · rejected below floor" value={<span data-palette-rejected={ranked.rejected}>{`${items.length} · ${ranked.shown.length} · ${ranked.rejected}`}</span>} />
        <Readout label="last run" value={<span data-palette-last={last ?? ""}>{last ?? "—"}</span>} />
        <Readout label="session ledger" value={recent.length ? recent.join(" › ") : "empty — the empty query lists the ledger first"} tone="text-slate-400" />
      </div>
      <p className="mt-2 type-caption text-slate-500">The action strip at the top of the scene renders the same registry: a command cannot ship to one and miss the other.</p>
    </Region>
  );
}
