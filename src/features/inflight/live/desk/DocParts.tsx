"use client";

// The inner pages' building blocks — figure strip, verdict chip, dimension tag, log lines, the bottom
// prev/next pair. No hooks: navigation arrives as callbacks from the client layer.

import type { ReactNode } from "react";
import { DIM_NAMES, verdictKey, verdictWord } from "./deskFormat";
import type { DeskRoute } from "./deskRoute";
import { LOG_GLYPH, type LogLine } from "./laneDocModel";
import l from "./deskLayers.module.css";

export interface NavTarget {
  label: string;
  /** The top bar's shorter word ("#40"); the label when absent. */
  short?: string;
  to: DeskRoute;
}

export type Cell = [value: ReactNode, label: string, tone?: string];

export function Strip({ cells }: { cells: Cell[] }) {
  return (
    <div className={l.strip}>
      {cells.map(([v, label, tone], i) => (
        <div key={i}>
          <b className={tone}>{v}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function VChip({ verdict, errored }: { verdict: string | null | undefined; errored?: boolean }) {
  if (errored) return <span className={`${l.vchip} ${l.err}`}>errored</span>;
  return <span className={`${l.vchip} ${l[verdictKey(verdict)]}`}>{verdictWord(verdict)}</span>;
}

export function DimTag({ id }: { id: string | null | undefined }) {
  if (!id) return null;
  return (
    <span className={l.dimTag} title={DIM_NAMES[id] ?? id}>
      {id}
    </span>
  );
}

export function LogList({ lines, preview }: { lines: LogLine[]; preview?: boolean }) {
  return (
    <div className={`${l.panel} ${l.logs} ${preview ? l.preview : ""}`}>
      {lines.map((x, i) => (
        <div key={i} className={`${l.logl} ${l[x.kind]}`}>
          <span className={l.t}>{x.t}</span>
          <span className={l.g}>{LOG_GLYPH[x.kind]}</span>
          <span className={l.x}>{x.text}</span>
        </div>
      ))}
    </div>
  );
}

export function PrevNext({ prev, next, go }: { prev: NavTarget | null; next: NavTarget | null; go: (to: DeskRoute) => void }) {
  return (
    <div className={l.pn}>
      {prev ? (
        <button type="button" onClick={() => go(prev.to)}>
          <small>← previous</small>
          {prev.label}
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button type="button" className={l.next} onClick={() => go(next.to)}>
          <small>next →</small>
          {next.label}
        </button>
      ) : null}
    </div>
  );
}

export function DocHead({ kick, title, sub, aside, mono }: { kick: string; title: ReactNode; sub?: ReactNode; aside?: ReactNode; mono?: boolean }) {
  return (
    <div className={l.dhead}>
      <div>
        <div className={l.kick}>{kick}</div>
        <h1 className={mono ? l.monoH : undefined} data-role="desk-layer-h">
          {title}
        </h1>
        {sub ? <div className={l.sub}>{sub}</div> : null}
      </div>
      {aside ? <div>{aside}</div> : null}
    </div>
  );
}

export function DSec({ title, count, right, children }: { title: string; count?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className={l.dsec}>
      <h3>
        {title}
        {count != null ? <span className={l.count}>{count}</span> : null}
        {right ? <span className={l.right}>{right}</span> : null}
      </h3>
      {children}
    </div>
  );
}

/** A body paragraph on an inner page (≥ 14 px). */
export function Text({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`${l.prose} ${className}`} data-role="desk-layer-text">
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className={`${l.panel} ${l.empty}`}>{children}</div>;
}
