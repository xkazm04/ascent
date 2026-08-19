// Direction B — **Shelf**. The bundle as a published edition on a library shelf.
//
// Metaphor: a reference work, not a balance sheet. Each domain is a spine: a title, an imprint line
// naming what it is an edition OF, and a composition band showing how its golden paths are spread
// across categories. The counts are still there, but they are the caption under the object rather
// than the object itself.
//
// Why this direction is genuinely different from Ledger: a ledger answers "how much"; a shelf
// answers "what KIND of knowledge is this, and is it evenly built". Two bundles with identical
// totals can be shaped completely differently — 105 subjects concentrated in two categories is a
// specialist volume, spread across eight is a general reference — and a row of totals cannot show
// that at all. The composition band is the whole argument for this direction.
//
// Composition is derived from `categories` alone (the index's per-subject category map is not
// carried at overview level), so the band shows the SPREAD of declared categories, not a
// per-category subject histogram. It is honest about that in the caption rather than implying a
// precision the overview payload does not have.

import { Kicker } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { artifactTotal, type KnowledgeDomain, type KnowledgeView } from "@/lib/org/knowledge-view";

/** Turn a category id into its display form: `ui-surfaces` → `UI surfaces`. */
function categoryLabel(id: string): string {
  const words = id.split("-");
  const head = words[0] ?? id;
  const rest = words.slice(1).join(" ");
  const lead = head.length <= 3 ? head.toUpperCase() : head.charAt(0).toUpperCase() + head.slice(1);
  return rest ? `${lead} ${rest}` : lead;
}

function Spine({ domain }: { domain: KnowledgeDomain }) {
  const total = artifactTotal(domain);
  const { written, total: techniques } = domain.useWhenCoverage;
  const consultPct = techniques === 0 ? 0 : Math.round((written / techniques) * 100);
  // Depth: applications per golden path. A bundle with many paths and few applications is a
  // standard nobody has worked an example for yet — worth seeing at a glance.
  const depth = domain.subjects === 0 ? 0 : domain.applications / domain.subjects;

  return (
    <article className="rounded-2xl border border-divider bg-ink p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-medium text-slate-100">{domain.title}</h3>
        <span className="font-mono text-xs text-slate-600">knowledge/{domain.name}/</span>
      </div>

      <p className="mt-1 text-sm text-slate-400">
        A four-layer reference: <span className="tabular-nums text-slate-200">{domain.subjects}</span>{" "}
        golden paths, each carrying its techniques and worked applications.
      </p>

      {/* Composition band — one segment per declared category. */}
      <div className="mt-5 space-y-2">
        <Kicker tone="muted">Composition</Kicker>
        <div className="flex h-2 gap-px overflow-hidden rounded-full bg-divider">
          {domain.categories.map((c, i) => (
            <div
              key={c}
              className="flex-1 bg-accent"
              // A ramp across the band so segments are distinguishable without inventing a
              // per-category palette that would then need a legend nobody reads.
              style={{ opacity: 0.35 + (0.55 * (i + 1)) / domain.categories.length }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {domain.categories.map((c) => (
            <span key={c} className="font-mono text-xs text-slate-500">
              {categoryLabel(c)}
            </span>
          ))}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-divider pt-4">
        <div>
          <dt className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">Artifacts</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{total.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">Worked depth</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{depth.toFixed(1)}</dd>
          <dd className="font-mono text-xs text-slate-600">applications per path</dd>
        </div>
        <div>
          <dt className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">Consult-ready</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: scoreHex(consultPct) }}>
            {consultPct}%
          </dd>
          <dd className="font-mono text-xs text-slate-600">
            {written}/{techniques} carry use_when
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function KnowledgeShelf({ view }: { view: KnowledgeView }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Kicker tone="muted">On the shelf</Kicker>
        <p className="max-w-3xl text-sm text-slate-400">
          <span className="tabular-nums text-slate-200">{view.totals.domains}</span>{" "}
          {view.totals.domains === 1 ? "edition" : "editions"} published from the registry, carrying{" "}
          <span className="tabular-nums text-slate-200">{view.totals.subjects}</span> golden paths in total. Every
          repo in the fleet reads the same copy.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {view.domains.map((d) => (
          <Spine key={d.name} domain={d} />
        ))}
      </div>

      <p className="font-mono text-xs text-slate-500">
        Composition shows the categories a bundle declares, not a per-category subject histogram — the
        overview payload carries the category list, and counting subjects into it would need the full index.
      </p>
    </div>
  );
}
