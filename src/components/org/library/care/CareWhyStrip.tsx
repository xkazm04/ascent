"use client";

// The "why the app, not just the skill" strip (REGISTRY-AND-CARE-IMPL.md §5's table, made visible).
//
// The local mentor is the sensor and the coach; it cannot see the other repos, cannot remember across
// machines, cannot open the PR and cannot compare you to anyone anonymously. Each line below is
// COUNTED off the view model rather than asserted, so an empty workspace shows honest zeros and the
// argument stays falsifiable instead of being marketing copy inside the product.

import { HairlineGrid } from "@/components/ui";
import type { CarePersonalView } from "@/lib/org/care-view";

function Line({ label, value, body }: { label: string; value: string; body: string }) {
  return (
    <div className="bg-ink px-4 py-3.5">
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums text-white">{value}</div>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </div>
  );
}

export function CareWhyStrip({ personal }: { personal: CarePersonalView }) {
  const gaps = personal.myRepos.reduce((a, r) => a + r.openRecommendations.length, 0);
  const grounded = personal.moves.filter((m) => m.evidence).length;
  const promotable = personal.moves.filter((m) => m.state === "kept" && m.registryPromotable).length;
  const bandFields = personal.orgBands ? Object.keys(personal.orgBands).length : 0;
  const off = personal.setup.sharing.filter((s) => !s.shared).length;

  return (
    <HairlineGrid className="mt-3 sm:grid-cols-2 xl:grid-cols-5">
      <Line
        label="Map"
        value={`${personal.myRepos.length} repos · ${gaps} gaps`}
        body="Your moves are read against the standing of every repo you commit to — a machine-local skill sees one working copy."
      />
      <Line
        label="Evidence"
        value={`${grounded} of ${personal.moves.length} moves`}
        body="Carry fleet proof: what the same move did for other repos, from the registry catalog."
      />
      <Line
        label="Bridge"
        value={`${promotable} promotable`}
        body="A move you kept can become a registry skill with you as its author — champions from evidence, not nomination."
      />
      <Line
        label="Memory"
        value={`${personal.journal.length} entries`}
        body="Profile and journal survive a reinstall, a new laptop and a month away."
      />
      <Line
        label="Boundary"
        value={`${off} things never shared`}
        body="The ledger below names them. Content never travels; comparison is anonymous and opt-in."
      />
      {bandFields === 0 ? null : (
        <Line
          label="Baseline"
          value={`${bandFields} anonymous bands`}
          body="Where your shape sits against the org, without anyone seeing you."
        />
      )}
    </HairlineGrid>
  );
}
