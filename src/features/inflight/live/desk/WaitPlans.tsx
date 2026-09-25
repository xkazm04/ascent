// Evidence for the plan cards — a pending plan (or one still "executing" after its run ended): its
// intent, its approach with the files it names, and its facts. Read-only: the verdict is given on the
// Ledger. No hooks.

import type { LoopPlanRecord } from "../ledger/ledgerTypes";
import { DSec, Text } from "./DocParts";
import { date, hm, repoShort } from "./deskFormat";
import l from "./deskLayers.module.css";

const CLASS_WORD: Record<string, string> = { major: "major · architecture move", minor: "minor", "minor-under-direction": "minor · inside a direction" };

export function PlanEvidence({ plan }: { plan: LoopPlanRecord }) {
  const p = plan.plan;
  return (
    <div className={l.cols}>
      <div>
        <DSec title="Intent">
          <div className={l.panel}>
            <div className={l.item}>
              <div className={l.h}>
                <span>{plan.itemTitles[0] ?? "Untitled item"}</span>
              </div>
              {p?.intent ? <Text className={l.b}>{p.intent}</Text> : <Text className={l.b}>The plan carried no readable intent.</Text>}
            </div>
          </div>
        </DSec>
        {p?.items.length ? (
          <DSec title="Approach" count={p.items.length}>
            <div className={l.panel}>
              {p.items.map((it, i) => (
                <div key={i} className={l.item}>
                  <Text>{it.approach}</Text>
                  {it.files.length ? (
                    <div className={l.m}>
                      {it.files.map((f) => (
                        <span key={f} className={l.fileChip}>
                          {f}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </DSec>
        ) : null}
      </div>
      <div>
        <DSec title="Plan facts">
          <div className={l.panel}>
            <dl className={l.dl}>
              <dt>repo</dt>
              <dd>{repoShort(plan.repo)}</dd>
              <dt>class</dt>
              <dd>{CLASS_WORD[plan.cls] ?? plan.cls}</dd>
              <dt>why</dt>
              <dd>{plan.clsReason ?? "-"}</dd>
              <dt>check</dt>
              <dd>{p?.check || "-"}</dd>
              <dt>status</dt>
              <dd>{plan.status}</dd>
              <dt>filed</dt>
              <dd>
                {date(plan.createdAt)} {hm(plan.createdAt)} UTC
              </dd>
            </dl>
          </div>
        </DSec>
        {p?.risks.length ? (
          <DSec title="Risks" count={p.risks.length}>
            <div className={l.panel}>
              {p.risks.map((r, i) => (
                <div key={i} className={l.item}>
                  <Text>{r}</Text>
                </div>
              ))}
            </div>
          </DSec>
        ) : null}
      </div>
    </div>
  );
}
