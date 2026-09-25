"use client";

// 05 NEXT ROUND SETUP — the next round as a ticket, prefilled from the newest round, with four control
// blocks under it. The draft lives in this browser. NO DISPATCH from the desk in this beta: the primary
// button continues in the Cockpit, which owns setup and the dispatch path — said in the ⓘ, not a paragraph.

import { useMemo } from "react";
import { Tip } from "./DeskTip";
import type { DeskCtx } from "./deskCtx";
import { repoShort } from "./deskFormat";
import { ArmBlock, GuardsBlock, ReposBlock, ShapeBlock } from "./SetupBlocks";
import { armChoices, planOn, prefill, repoOptions } from "./setupModel";
import { splitArm } from "./armsModel";
import { useSetupDraft } from "./useSetupDraft";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

export function NextRoundSetup({ ctx }: { ctx: DeskCtx }) {
  const { data, fold, arms, hrefs, slug } = ctx;
  const rounds = useMemo(() => fold?.rounds ?? [], [fold]);
  const initial = useMemo(() => prefill(data, rounds, arms), [data, rounds, arms]);
  const [draft, act, reset] = useSetupDraft(slug, initial);
  const repos = useMemo(() => repoOptions(data, rounds), [data, rounds]);
  const choices = useMemo(() => armChoices(arms), [arms]);
  const newestSeq = rounds.reduce<number | null>((m, x) => (x.seq != null && (m == null || x.seq > m) ? x.seq : m), null);
  const armWord = draft.arms.length === 0 ? "no arm" : draft.arms.length === 1 ? splitArm(draft.arms[0]!).exec : `${draft.arms.length} arms`;

  return (
    <section className={s.sec} data-role="desk-sec" aria-labelledby="desk-h-next">
      <div className={s.sechead}>
        <h2 id="desk-h-next" data-role="desk-sechead">
          <span className={s.idx}>05</span>Next round setup
        </h2>
        <span className={s.count}>draft</span>
        <Tip text="Prefilled from the newest round and the last runner's dials. The draft stays in this browser. The desk does not dispatch: continue in the Cockpit to arm and start the round." />
        <div className={s.right}>
          <button type="button" className={`${s.btn} ${s.ghost} ${s.sm}`} onClick={reset}>
            Reset
          </button>
        </div>
      </div>
      <div className={r.setup}>
        <div className={r.ticket} data-role="desk-ticket">
          <div className={r.no}>
            {newestSeq != null ? `#${newestSeq + 1}` : "#1"}
            <small>NEXT ROUND</small>
          </div>
          <div className={r.spec}>
            <span>
              <em>repos</em>
              <b>{draft.repos.length ? draft.repos.map(repoShort).join(", ") : <span className={s.red}>none</span>}</b>
            </span>
            <span>
              <em>arm</em>
              <b>{armWord}</b>
            </span>
            <span>
              <em>cycles</em>
              <b>{draft.cycles}</b>
            </span>
            <span>
              <em>batch</em>
              <b>{draft.batch}</b>
            </span>
            <span>
              <em>ceiling</em>
              <b>${draft.ceiling}</b>
            </span>
            <span>
              <em>guards</em>
              <b>
                verify {draft.verify ? "on" : "off"} · plan {planOn(draft) ? "on" : "off"}
              </b>
            </span>
          </div>
          <div className={r.dispatch}>
            <a className={`${s.btn} ${s.primary}`} href={hrefs.cockpit}>
              Continue in Cockpit
            </a>
          </div>
        </div>
        <div className={r.blocks}>
          <div className={r.bcol}>
            <ReposBlock repos={repos} draft={draft} act={act} />
            <ShapeBlock draft={draft} act={act} />
            <GuardsBlock draft={draft} act={act} />
          </div>
          <div className={r.bcol}>
            <ArmBlock arms={choices} draft={draft} act={act} />
          </div>
        </div>
      </div>
    </section>
  );
}
