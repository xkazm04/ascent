"use client";

// Search over what the desk already holds — rounds, repos, arms. "/" focuses it from anywhere on the
// page, arrows walk the hits, Enter opens one, Esc clears.

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeskRoute } from "./deskRoute";
import { searchHits, type SearchHit } from "./searchModel";
import s from "./desk.module.css";

export function DeskSearch({ index, go }: { index: SearchHit[]; go: (to: DeskRoute) => void }) {
  const [q, setQ] = useState("");
  const [on, setOn] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchHits(index, q), [index, q]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "/") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const click = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("click", click);
    };
  }, []);

  const pick = (h: SearchHit | undefined) => {
    if (!h) return;
    go(h.to);
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className={s.search} role="search" ref={box}>
      <input
        ref={input}
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Find a round, repo or arm"
        aria-label="Search rounds, repos and arms"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOn(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") pick(hits[on]);
          else if (e.key === "Escape") {
            setQ("");
            setOpen(false);
            e.currentTarget.blur();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOn((i) => Math.max(0, Math.min(hits.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
          }
        }}
      />
      {open && q.trim() ? (
        <div className={s.results} role="listbox" aria-label="Search results">
          {hits.length === 0 ? <div className={s.grp}>No match</div> : null}
          {hits.map((h, i) => {
            const head = i === 0 || hits[i - 1]!.group !== h.group ? h.group : null;
            return (
              <div key={`${h.group}:${h.title}:${i}`}>
                {head ? <div className={s.grp}>{head}</div> : null}
                <button type="button" role="option" aria-selected={i === on} className={i === on ? s.on : undefined} onClick={() => pick(h)}>
                  {h.title}
                  <span className={s.ctx}>{h.ctx}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
