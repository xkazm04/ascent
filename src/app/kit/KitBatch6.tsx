"use client";

// Kit batch 6 specimen (2026-10-22): the parts promoted out of the phase-1 Prism compositions (Notice,
// FilterBar + FilterCount, FillBar + BarRow, SortHead, DecisionLedger, Display/Caption as inline elements),
// then the Live desk and On Air wall palettes. Synthetic data only.
import { useState } from "react";
import {
  BarRow, Caption, CELL, DataTable, DecisionLedger, Display, FillBar, FilterBar, FilterCount, FilterMenu, Input, Notice, SortHead, type LedgerColumn,
} from "@/components/kit";
import { KitLive } from "./KitLive";

interface Gap {
  id: string;
  repo: string;
  title: string;
}
const GAPS: Gap[] = [
  { id: "g1", repo: "sample-api", title: "Add an agent guidance file" },
  { id: "g2", repo: "sample-web", title: "Require tests on changed code" },
  { id: "g3", repo: "sample-infra", title: "Gate releases on a passing scan" },
];
const COLUMNS: LedgerColumn<Gap>[] = [
  { key: "repo", header: "Repo", cell: (r) => <span className="font-mono type-mono-sm text-slate-300">{r.repo}</span> },
  { key: "title", header: "Gap", cell: (r, c) => (
    <button type="button" onClick={c.toggleOpen} className="focus-ring text-left text-slate-100 hover:text-white">{r.title}</button>
  ) },
];
const SORT_ROWS = [["sample-api", 72], ["sample-web", 58], ["sample-infra", 81]] as const;

function Row({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <div data-specimen={`b6-${name}`} className="grid gap-4 border-t border-divider py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <p className="font-mono type-mono-sm text-slate-300">{name}</p>
        <p className="type-note text-slate-400">{note}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

export function KitBatch6() {
  const [picked, setPicked] = useState<Set<string>>(new Set(["g1"]));
  const [repos, setRepos] = useState<Set<string>>(new Set(["sample-api"]));
  const [asc, setAsc] = useState(false);
  const rows = [...SORT_ROWS].sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1]));
  return (
    <section aria-label="Kit batch 6" className="mt-12">
      <p className="type-label tracking-[0.22em] text-slate-400">Batch 6 · promoted parts and the Live palettes</p>
      <Row name="Notice" note="The ruled status banner: a paper edge, a ! glyph and the words. Error is announced; info is polite. Never a coloured box.">
        <Notice>Save failed: the registry refused the index.</Notice>
        <Notice tone="info">Indexed 12 skills.</Notice>
      </Row>
      <Row name="FilterBar · FilterCount" note="Facet menus, search and view switches in one wrapping row, with the N of M readout and Clear filters at the far edge.">
        <FilterBar>
          <FilterMenu
            label="Repo"
            options={GAPS.map((g) => ({ value: g.repo, label: g.repo }))}
            selected={repos}
            onToggle={(v) => setRepos((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; })}
            onClear={() => setRepos(new Set())}
          />
          <Input type="search" placeholder="Search gaps…" aria-label="Search gaps" className="w-48" />
          <FilterCount shown={repos.size === 0 ? 3 : 1} total={3} active={repos.size > 0} onClear={() => setRepos(new Set())} />
        </FilterBar>
      </Row>
      <Row name="FillBar · BarRow" note="A thin bar whose width is the value, paper on a hairline wash (a dimension hue only when the bar names one). BarRow is name, bar, readout.">
        <FillBar value={64} label="64% adopted" />
        <ul className="divide-y divide-divider">
          <BarRow name="octocat" value={82} label="82% AI-attributed" readout="82% · 41/50" />
          <BarRow name="hubot" value={37} label="37% AI-attributed" readout="37% · 9/24" />
        </ul>
      </Row>
      <Row name="SortHead" note="A sortable column head: one button, a direction glyph and aria-sort. The inactive columns show a neutral glyph.">
        <DataTable
          variant="plain"
          size="sm"
          caption="Repositories by score"
          head={
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-normal">Repo</th>
              <SortHead active dir={asc ? "asc" : "desc"} onSort={() => setAsc((v) => !v)} align="right" idle>Score</SortHead>
            </tr>
          }
        >
          {rows.map(([repo, score]) => (
            <tr key={repo} className="border-b border-divider">
              <td className={CELL}>{repo}</td>
              <td className={`${CELL} text-right tabular-nums`}>{score}</td>
            </tr>
          ))}
        </DataTable>
      </Row>
      <Row name="DecisionLedger" note="Selectable ruled rows, a sticky batch bar with one paper action, and a row that opens in place. Rows, columns and actions are the caller's.">
        <DecisionLedger<Gap>
          caption="Open gaps"
          rows={GAPS}
          rowId={(r) => r.id}
          rowLabel={(r) => r.title}
          columns={COLUMNS}
          selected={picked}
          onSelectedChange={setPicked}
          renderDetail={(r) => <Caption>Detail for {r.title}.</Caption>}
          actions={[{ key: "apply", label: "Apply", busyLabel: "Applying…", tone: "primary", run: () => undefined }, { key: "dismiss", label: "Dismiss", busyLabel: "Dismissing…", tone: "neutral", run: () => undefined }]}
        />
      </Row>
      <Row name="Display as span · Caption as span" note="Inline forms for a statement or caption that sits inside running text or beside a control.">
        <p className="type-body text-slate-300">
          Fleet score <Display as="span" level="figure">87</Display> <Caption as="span">up 3 since the last scan</Caption>
        </p>
      </Row>
      <KitLive />
    </section>
  );
}
