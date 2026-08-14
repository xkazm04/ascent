"use client";

// Map view — "efficiency quadrant" (the PassportScatter idiom): one point per repo, x = how much AI
// actually reaches the work (aiInvolvedRate), y = noCostSource $/mo spent, size = seats, color = the ROI
// verdict. The four regions answer "is the spend working?" at a glance — money with no AI reaching PRs
// floats top-left (idle/waste), high-AI-low-cost sits bottom-right (lean). A verdict legend filters the
// cloud, and a side rail turns the concern cohorts (ungoverned / idle / shadow) into an action list
// with report links. Client (hover + filter state).
//
// The scatter (AiRoiQuadrantMap) and the action rail (AiRoiQuadrantActions) are extracted siblings —
// this file owns the shared hover/filter state and the pure scale math, and stays under the 200-LOC
// cap (AGENTS.md) by keeping the JSX itself thin.

import { useState } from "react";
import Link from "next/link";
import type { AiDeliveryModel, AiRepoRoi, Verdict } from "./aiDeliveryModel";
import { AiRoiQuadrantMap } from "./AiRoiQuadrantMap";
import { AiRoiQuadrantActions } from "./AiRoiQuadrantActions";

const ADOPT_SPLIT = 15; // matches the model's ADOPT_HI

export function AiRoiQuadrant({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const [active, setActive] = useState<Verdict | null>(null);
  const [hover, setHover] = useState<AiRepoRoi | null>(null);
  const noCostSource = model.fidelity === "none";

  const xMax = Math.max(20, Math.ceil(Math.max(...model.repos.map((r) => r.aiInvolvedRate)) / 10) * 10);
  const meanSpend = model.summary.totalMonthlySpend / Math.max(1, model.summary.repos);
  const yMax = Math.max(500, Math.ceil(Math.max(...model.repos.map((r) => r.monthlySpend)) / 500) * 500);
  const ySplit = Math.max(meanSpend, 200);

  const W = 480;
  const H = 356;
  const PAD_L = 44;
  const PAD_R = 14;
  const PAD_T = 44;
  const PAD_B = 52;
  const px = (v: number) => PAD_L + (Math.max(0, Math.min(xMax, v)) / xMax) * (W - PAD_L - PAD_R);
  const py = (v: number) => H - PAD_B - (Math.max(0, Math.min(yMax, v)) / yMax) * (H - PAD_B - PAD_T);
  const seatR = (seats: number) => 4 + Math.min(8, seats / 8);

  const splitX = px(ADOPT_SPLIT);
  const splitY = py(ySplit);

  return (
    <div className="space-y-3">
      {noCostSource && (
        <p className="text-xs text-slate-500">
          Spend (Y-axis) and seat sizes are a deterministic sample — only AI reach (X-axis) is real (git).{" "}
          <Link href={`/org/${slug}/integrations`} className="text-accent transition hover:underline">
            Connect a provider
          </Link>{" "}
          for real spend.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <AiRoiQuadrantMap
          model={model}
          noCostSource={noCostSource}
          active={active}
          setActive={setActive}
          hover={hover}
          setHover={setHover}
          px={px}
          py={py}
          seatR={seatR}
          splitX={splitX}
          splitY={splitY}
        />
        <AiRoiQuadrantActions model={model} slug={slug} noCostSource={noCostSource} />
      </div>
    </div>
  );
}
