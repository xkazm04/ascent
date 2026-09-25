"use client";

// 01 WAITING ON YOU — a row of ticket cards: a number, a short title, one source line. Each card is a
// door to its evidence page; a calm card (nothing waits) is not. Event handlers, so "use client"; the
// navigation callback arrives from the client parent.

import { Tip } from "./DeskTip";
import type { DeskCtx } from "./deskCtx";
import type { WaitCard } from "./waitingModel";
import s from "./desk.module.css";

const TONE = { amber: s.toneAmber, red: s.toneRed, blue: s.toneBlue } as const;

function Card({ c, onOpen }: { c: WaitCard; onOpen: () => void }) {
  const cls = [s.card, c.live ? s.live : "", c.calm ? s.calm : ""].join(" ");
  const src = (
    <span className={`${s.src} ${c.src === "live" ? s.live : ""}`} data-role="desk-chip">
      {c.live ? <span className={s.pulseDot} /> : null}
      {c.src}
    </span>
  );
  const body = (
    <>
      <div className={s.k}>
        <span className={s.cap}>{c.cap}</span>
        {src}
      </div>
      <div className={`${s.n} ${c.tone && !c.live ? TONE[c.tone] : ""}`} data-role="desk-card-n">
        {c.n}
      </div>
      <div className={s.t}>{c.title}</div>
      <div className={s.s}>{c.sub}</div>
    </>
  );
  if (c.calm)
    return (
      <div className={cls} data-role="desk-card" data-card={c.key}>
        {body}
      </div>
    );
  return (
    <button type="button" className={cls} data-role="desk-card" data-card={c.key} onClick={onOpen} aria-label={`${c.cap}: ${c.n} — ${c.title}`}>
      {body}
      <span className={s.go}>→</span>
    </button>
  );
}

export function WaitingSection({ ctx }: { ctx: DeskCtx }) {
  const { waiting, go } = ctx;
  return (
    <section className={s.sec} data-role="desk-sec" aria-labelledby="desk-h-waiting">
      <div className={s.sechead}>
        <h2 id="desk-h-waiting" data-role="desk-sechead">
          <span className={s.idx}>01</span>Waiting on you
        </h2>
        <span className={s.count}>{waiting.open} open</span>
        <Tip text="Ranked: what needs a person first, then what is worth a read. Each card opens its evidence; decisions are made on the Ledger." />
      </div>
      <div className={s.cards} style={{ ["--cards" as string]: Math.max(5, waiting.cards.length) }}>
        {waiting.cards.map((c) => (
          <Card key={c.key} c={c} onOpen={() => go({ kind: "wait", key: c.key })} />
        ))}
      </div>
    </section>
  );
}
