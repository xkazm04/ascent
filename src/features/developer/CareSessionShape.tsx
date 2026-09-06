"use client";

// The session-shape strip: the 30-day counts the developer CHOSE to share, each read against an
// anonymous org band (quartiles only — a band can never be resolved back to a person), rendered as a
// TILE_LEDGER row of stats.
//
// A field the developer did not share renders as an explicit "not shared" cell, never as a zero.

import { TILE_LEDGER, Tile } from "@/components/org/shared/ui";
import {
  CARE_SHAPE_LABEL,
  CARE_SHAPE_ORDER,
  careBandVerdict,
  careShapeValue,
  type DeveloperView,
} from "@/lib/org/developer-view";

function NotShared({ label }: { label: string }) {
  return (
    <div className="bg-ink px-5 py-3.5">
      <div className="font-mono type-micro uppercase leading-snug tracking-[0.12em] text-slate-600">{label}</div>
      <div className="mt-0.5 type-figure font-bold text-slate-700">—</div>
      <div className="mt-0.5 type-body-sm text-slate-600">not shared</div>
    </div>
  );
}

export function CareSessionShape({ personal }: { personal: DeveloperView }) {
  const shared = new Set(personal.sharedFields);
  const bands = personal.orgBands;

  return (
    <div className={`${TILE_LEDGER} mt-3 sm:grid-cols-2 lg:grid-cols-3`}>
      {CARE_SHAPE_ORDER.map((field) => {
        const value = personal.shape[field];
        if (!shared.has(field) || value == null) return <NotShared key={field} label={CARE_SHAPE_LABEL[field]} />;
        const verdict = careBandVerdict(field, value, bands?.[field]);
        return (
          <Tile
            key={field}
            label={CARE_SHAPE_LABEL[field]}
            value={careShapeValue(field, value)}
            sub={verdict ? `org: ${verdict}` : "no org band"}
          />
        );
      })}
    </div>
  );
}
