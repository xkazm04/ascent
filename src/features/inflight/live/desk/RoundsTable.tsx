"use client";

// The last-rounds table under the flight log: filter chips with their counts, eight rounds a page,
// newest first. A row opens its round (click or Enter); hovering a row selects its column on the log.

import { useMemo, useState } from "react";
import { date, dur, hm, repoShort, signed, usd } from "./deskFormat";
import { Pips } from "./Pips";
import type { DeskRound } from "./roundsModel";
import { roundFilters, tablePage } from "./tableModel";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

interface Props {
  rounds: DeskRound[];
  onOpen: (round: DeskRound) => void;
  onHover: (round: DeskRound) => void;
}

export function RoundsTable({ rounds, onOpen, onHover }: Props) {
  const filters = useMemo(() => roundFilters(rounds), [rounds]);
  const [fid, setFid] = useState("all");
  const [page, setPage] = useState(0);
  const filter = filters.find((f) => f.id === fid) ?? filters[0]!;
  const view = tablePage(rounds, filter, page);

  return (
    <>
      <div className={r.tblbar}>
        <span className={s.cap} style={{ marginRight: 8 }}>
          Last rounds
        </span>
        <span className={r.filters}>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={s.chip}
              data-role="desk-chip"
              aria-pressed={f.id === filter.id}
              onClick={() => {
                setFid(f.id);
                setPage(0);
              }}
            >
              {f.label} · {rounds.filter(f.test).length}
            </button>
          ))}
        </span>
      </div>
      <div className={r.tblwrap}>
        <table className={r.tbl} data-role="desk-rtable">
          <thead>
            <tr>
              <th>Round</th>
              <th>Started</th>
              <th>Took</th>
              <th>Repos</th>
              <th>Lanes</th>
              <th className={r.n}>Verified closes</th>
              <th className={r.n}>Reported $</th>
              <th className={r.n}>Lift</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const cost = usd(row.costMicros);
              return (
                <tr
                  key={row.id}
                  tabIndex={0}
                  data-testid="desk-rtable-row"
                  onClick={() => onOpen(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpen(row);
                  }}
                  onMouseEnter={() => onHover(row)}
                >
                  <td className={r.seq}>
                    {row.label}
                    {row.error ? (
                      <span className={s.red} title="the run recorded an error">
                        {" "}!
                      </span>
                    ) : null}
                  </td>
                  <td className={s.mono}>
                    {date(row.startMs)} {hm(row.startMs)}
                  </td>
                  <td className={s.mono}>{row.durMs != null ? dur(row.durMs) : "running"}</td>
                  <td data-role="desk-rtable-td">{row.repos.map(repoShort).join(", ")}</td>
                  <td>{row.lanesKnown ? <Pips lanes={row.lanes} /> : <span className={r.unk}>could not read</span>}</td>
                  <td className={`${r.n} ${row.closes ? s.green : s.faint}`}>{row.closes}</td>
                  <td className={r.n}>
                    {cost ? (
                      <>
                        {cost}
                        {row.costUnknown ? <span className={s.faint}> +{row.costUnknown} n.r.</span> : null}
                      </>
                    ) : (
                      <span className={r.unk}>not reported</span>
                    )}
                  </td>
                  <td className={r.n}>
                    {row.lift == null ? <span className={r.unk}>-</span> : <span className={row.lift > 0 ? s.green : row.lift < 0 ? s.red : s.faint}>{signed(row.lift)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={r.pager}>
        <button type="button" aria-label="Newer" onClick={() => setPage(Math.max(0, view.page - 1))}>
          ‹
        </button>
        {Array.from({ length: view.pages }, (_, i) => (
          <button key={i} type="button" aria-current={i === view.page} onClick={() => setPage(i)}>
            {i + 1}
          </button>
        ))}
        <button type="button" aria-label="Older" onClick={() => setPage(Math.min(view.pages - 1, view.page + 1))}>
          ›
        </button>
        <span className={r.of}>{view.range} · newest first</span>
      </div>
    </>
  );
}
