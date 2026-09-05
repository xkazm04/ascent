// "WHAT THIS STANCE CANNOT ENFORCE" — the honest half of the perimeter.
//
// `compileStance` has always built this list, and until now its only readers were two MCP tools. So
// the AGENT was told which clauses only it can honour, and the OWNER publishing the stance was not:
// the perimeter showed the declaration and the controls beside it, and said nothing about the gap
// between them. A person deciding what to declare needs that gap more than an agent obeying it does.
//
// It reads the SAME function the MCP tools' compiled output comes from (`unenforceableClauses`,
// which `compileStance` itself calls), so a clause cannot say one thing to an agent and another to a
// person. At org scope the facts are null, which is the reading that holds for the declaration
// whichever repository it lands in — it never claims a repo's branch governance is unreadable,
// because at this altitude no repository has been read.
//
// Server-safe: no hooks, no handlers, so no "use client".

import { Kicker } from "@/components/ui";
import type { UnenforceableClause } from "@/lib/org/admission";

/**
 * The list, or nothing at all.
 *
 * NOTHING is the right empty state, not a reassurance. "Every clause is enforced" is a claim this
 * component is in no position to make — the list being empty means the stance declares none of the
 * clauses that compile into nothing, which is not the same sentence.
 */
export function UnenforceableClauses({ clauses }: { clauses: UnenforceableClause[] }) {
  if (clauses.length === 0) return null;
  return (
    <section>
      <Kicker tone="muted">What this stance cannot enforce</Kicker>
      <p className="mb-3 mt-2 max-w-3xl type-body text-slate-300">
        {clauses.length} clause{clauses.length === 1 ? "" : "s"} above {clauses.length === 1 ? "stays" : "stay"} declared:
        nothing in the product compiles {clauses.length === 1 ? "it" : "them"} into a control that can refuse a change.
        An agent reading the stance through MCP is told exactly this — so is everyone here.
      </p>
      <ul className="divide-y divide-divider rounded-xl border border-divider bg-surface/40">
        {clauses.map((c) => (
          <li key={c.clause} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <span className="font-mono type-micro uppercase tracking-[0.14em] text-orange-300">{c.clause}</span>
            <span className="flex-1 basis-64 type-body-sm text-slate-400">{c.why}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
