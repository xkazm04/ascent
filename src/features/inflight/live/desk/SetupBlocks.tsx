"use client";

// The next round's four control blocks — repos, arm, shape steppers, guard switches. Controlled: every
// change is a `SetupAction` handed to the parent's reducer. No hooks.

import { Tip } from "./DeskTip";
import type { ArmRow } from "./armsModel";
import { repoShort, usd } from "./deskFormat";
import { LIMITS, STEP, isSplit, planForced, planOn, type RepoOption, type SetupAction, type SetupDraft, type StepKey } from "./setupModel";
import r from "./deskRounds.module.css";
import s from "./desk.module.css";

type Act = (a: SetupAction) => void;

function Stepper({ k, label, draft, act, pre = "" }: { k: StepKey; label: string; draft: SetupDraft; act: Act; pre?: string }) {
  const [lo, hi] = LIMITS[k];
  return (
    <div className={r.stepper}>
      <label id={`desk-step-${k}`}>{label}</label>
      <div className={r.ctl} role="group" aria-labelledby={`desk-step-${k}`}>
        <button type="button" aria-label={`less ${label}`} disabled={draft[k] <= lo} onClick={() => act({ type: "step", key: k, delta: -STEP[k] })}>
          −
        </button>
        <output>
          {pre}
          {draft[k]}
        </output>
        <button type="button" aria-label={`more ${label}`} disabled={draft[k] >= hi} onClick={() => act({ type: "step", key: k, delta: STEP[k] })}>
          +
        </button>
      </div>
    </div>
  );
}

export function ReposBlock({ repos, draft, act }: { repos: RepoOption[]; draft: SetupDraft; act: Act }) {
  return (
    <div className={r.block}>
      <div className={`${s.cap} ${r.bcap}`}>
        Repos <Tip text="Paired checkouts first, with the last round each ran in. A repo with no local checkout cannot be dispatched to." />
      </div>
      <div className={r.opts}>
        {repos.length === 0 ? <span className={s.faint}>No paired repo</span> : null}
        {repos.map((o) => (
          <button key={o.repo} type="button" className={r.opt} role="checkbox" aria-checked={draft.repos.includes(o.repo)} disabled={!o.paired} onClick={() => act({ type: "repo", repo: o.repo })}>
            <span className={r.box} />
            <span className={r.nm}>{repoShort(o.repo)}</span>
            <span className={r.mt}>{o.paired ? (o.lastSeq != null ? `#${o.lastSeq}` : "new") : "not paired"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ArmBlock({ arms, draft, act }: { arms: ArmRow[]; draft: SetupDraft; act: Act }) {
  const single = draft.policy === "single";
  return (
    <div className={r.block}>
      <div className={`${s.cap} ${r.bcap}`}>
        Arm <Tip text="One arm, or compare 2–4 arms in one round. $ per close counts priced lanes only." />
        <span className={s.seg} style={{ marginLeft: "auto" }}>
          <button type="button" aria-pressed={single} onClick={() => act({ type: "policy", policy: "single" })}>
            single
          </button>
          <button type="button" aria-pressed={!single} onClick={() => act({ type: "policy", policy: "compare" })}>
            compare
          </button>
        </span>
      </div>
      <div className={r.opts} role={single ? "radiogroup" : "group"} aria-label="Arm">
        {arms.length === 0 ? <span className={s.faint}>No arm recorded yet</span> : null}
        {arms.map((a) => (
          <button key={a.key} type="button" className={`${r.opt} ${single ? r.radio : ""}`} role={single ? "radio" : "checkbox"} aria-checked={draft.arms.includes(a.key)} onClick={() => act({ type: "arm", arm: a.key })}>
            <span className={r.box} />
            <span className={r.nm} title={a.key}>
              {a.exec}
              {isSplit(a.key) ? <span className={s.faint} style={{ fontWeight: 400 }}> · split</span> : null}
            </span>
            <span className={r.mt}>
              {a.closes} cl · {a.perCloseMicros != null ? `${usd(a.perCloseMicros)}/cl` : "$/cl unknown"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ShapeBlock({ draft, act }: { draft: SetupDraft; act: Act }) {
  return (
    <div className={r.block}>
      <div className={`${s.cap} ${r.bcap}`}>
        Shape <Tip text="Cycles per repo, follow-ups per lane, and the daily money ceiling the runner stops at." />
      </div>
      <div className={r.steppers}>
        <Stepper k="cycles" label="cycles" draft={draft} act={act} />
        <Stepper k="batch" label="batch" draft={draft} act={act} />
        <Stepper k="ceiling" label="ceiling" draft={draft} act={act} pre="$" />
      </div>
    </div>
  );
}

export function GuardsBlock({ draft, act }: { draft: SetupDraft; act: Act }) {
  const forced = planForced(draft);
  return (
    <div className={r.block}>
      <div className={`${s.cap} ${r.bcap}`}>
        Guards <Tip text="Verify runs the repo's own check before and after. A split arm always plans, so plan mode is forced on." />
      </div>
      <div className={r.toggles}>
        <div className={r.toggle}>
          <span>Verify guard</span>
          <button type="button" className={r.sw2} role="switch" aria-checked={draft.verify} aria-label="Verify guard" onClick={() => act({ type: "toggle", key: "verify" })} />
        </div>
        <div className={r.toggle}>
          <span>
            Plan mode
            {forced ? <span className={`${s.faint} ${s.mono}`} style={{ fontSize: 12 }}> · forced by split arm</span> : null}
          </span>
          <button type="button" className={r.sw2} role="switch" aria-checked={planOn(draft)} aria-label="Plan mode" disabled={forced} onClick={() => act({ type: "toggle", key: "plan" })} />
        </div>
      </div>
    </div>
  );
}
