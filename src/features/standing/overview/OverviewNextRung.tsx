// "Next rung" — the Overview as a PERSUADING screen. Epicenter: a VP between meetings learns whether
// the fleet is climbing and how far the next level is, in one figure, one sentence and one line.
//
// Reference: Felton Annual Report — the enormous figure with its meaning spelled out in prose, one
// annotated line in mono captions, no legend, no gauge, no hover. Axioms: spacious · type-figure-lg
// over type-body · level ramp only (accent = the one link) · bare text on ink · no motion.
//
// Deleted from the baseline on purpose: the four-badge strip (adoption/rigor become one lever
// sentence, coverage becomes a dateline clause), the posture bar, the nine-row dimension ledger, the
// cohort rollup and the repo × dimension heatmap. Cut after the critic's pass: the hover crosshair,
// the band label, the level glyph, the arrival fade. This reader reads a sentence out loud and moves on.
//
// No hooks anywhere in this variant — it is client only because the switcher is.

import { Kicker } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { buildUrl } from "@/lib/org/orgTabs";
import type { OverviewLedgerData } from "./OverviewLedgerBaseline";
import { OverviewNextRungClimb } from "./OverviewNextRungClimb";
import { leverSentence, paceSentence, readNextRung } from "./nextRung";

export function OverviewNextRung(d: OverviewLedgerData) {
  const r = readNextRung(d.badges, d.trajectories);
  const reposHref = buildUrl(d.slug, { tab: "repositories" }, d.search);

  if (r.avg === null) {
    return (
      <section className="py-6">
        <Kicker tone="muted">Fleet standing · {d.periodTitle}</Kicker>
        <p className="mt-4 type-heading font-medium text-white">No scored repos in this period yet.</p>
        <p className="mt-2 type-body text-slate-400">Scan one to start the climb — the standing, the next rung and the line all begin with the first reading.</p>
        <a href={reposHref} className="focus-ring mt-6 inline-block type-mono-sm text-accent hover:text-white">
          Scan a repository →
        </a>
      </section>
    );
  }

  const lever = leverSentence(r);
  const rung = r.next;

  return (
    <section className="space-y-10 py-4">
      <div>
        <Kicker tone="muted">
          Fleet standing · {d.periodTitle}
          {r.scanned ? ` · ${r.scanned} repos scanned` : ""}
        </Kicker>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="type-figure-lg font-bold" style={{ color: scoreHex(r.avg) }}>
            {r.avg}
          </span>
          <p className="type-heading font-medium text-white">
            {r.level.name}
            {rung ? ` — ${r.distance} point${r.distance === 1 ? "" : "s"} from ${rung.name}.` : " — the top level."}
          </p>
        </div>
        <p className="mt-3 max-w-3xl type-lede text-slate-300">{paceSentence(r, d.periodTitle)}</p>
      </div>

      <OverviewNextRungClimb points={d.trend.points} level={r.level} next={rung} />

      <div className="max-w-3xl space-y-1.5 type-body text-slate-400">
        {lever && <p>{lever}</p>}
        <p>
          {rung
            ? `${r.atNextRung} of ${r.repos} repos ${r.atNextRung === 1 ? "is" : "are"} ${rung.name} or above.`
            : `${r.atNextRung} of ${r.repos} repos ${r.atNextRung === 1 ? "is" : "are"} at the top level.`}{" "}
          <a href={reposHref} className="focus-ring type-mono-sm text-accent hover:text-white">
            See every repo →
          </a>
        </p>
      </div>
    </section>
  );
}
