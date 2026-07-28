// The conversion panel under the cold-permalink gate (G6-26). A cold `/report/{owner}/{repo}` hit is
// the highest-intent moment in the funnel — a visitor already asking about a SPECIFIC repo — and it
// used to be spent on a bare empty state with one button.
//
// WHAT THIS DELIBERATELY IS NOT: a blurred/sample score ring, a "typical result", or any other
// preview of a number this repo has not earned. The rest of the product spent real effort removing
// exactly that class of dishonesty (mock scans are flagged, an incomplete report refuses to draw a
// number, demo badges say "demo"), so a teaser that implies a score here would be the same lie in a
// nicer wrapper. Instead it shows what a scan PRODUCES — the rubric that will be applied (the 9
// dimensions), the ladder the repo will land somewhere on (L1–L5), and the honest terms (free, no
// account, minutes not seconds, public result, capped allowance) — plus one escape hatch to a REAL
// finished report for the visitor who is not going to wait several minutes to see the format.
//
// Everything countable here is DERIVED from the maturity model (DIMENSIONS / LEVELS via
// LEVEL_COUNT & DIMENSION_COUNT), so the panel cannot drift from the rubric that actually runs.

import Link from "next/link";
import { LEVELS, DIMENSIONS } from "@/lib/maturity/model";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";
import { DEMO_ORG_NAME, DIMENSION_COUNT, LEVEL_COUNT, demoOrgHref } from "@/lib/site";
import { Surface, Kicker, Stat } from "@/components/ui";

/** One rubric dimension as a hairline chip — `D3 · CI/CD & Delivery`. No score, by design. */
function DimensionChip({ id, name }: { id: string; name: string }) {
  return (
    <span className="rounded-full border border-divider bg-surface/40 px-2.5 py-1 text-sm text-slate-300">
      <span className="font-mono text-slate-500">{id}</span> {name}
    </span>
  );
}

/**
 * The L1–L5 ladder, rendered as the destination set rather than a result: every level is shown at
 * equal weight and none is marked, so it reads as "one of these" and never as "probably this one".
 * Compact form of the LevelBadge recipe (same LEVEL_CLASSES ramp + LEVEL_GLYPH non-colour cue, one
 * density step down) because five of them sit in a row here.
 */
function LevelLadder() {
  return (
    <div className="flex flex-wrap gap-2" aria-label={`The ${LEVEL_COUNT}-level maturity ladder`}>
      {LEVELS.map((l) => {
        const lc = LEVEL_CLASSES[l.id];
        return (
          <span
            key={l.id}
            title={l.tagline}
            className={`inline-flex items-center gap-1.5 rounded-full border ${lc.border} ${lc.bg} px-2.5 py-1 text-sm font-medium ${lc.text}`}
          >
            <span aria-hidden>{LEVEL_GLYPH[l.id]}</span>
            {l.id} {l.name}
          </span>
        );
      })}
    </div>
  );
}

/** One disclosure line: a bullet the visitor would otherwise only discover mid-scan. */
function Term({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm leading-relaxed text-slate-400">
      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
      <span>{children}</span>
    </li>
  );
}

export function ColdScanTeaser() {
  return (
    <Surface radius="2xl" className="p-6 text-left" data-testid="cold-scan-teaser">
      <Kicker>What a scan produces</Kicker>

      <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-4">
        <Stat variant="figure-compact" value={DIMENSION_COUNT} label="dimensions scored" />
        <Stat variant="figure-compact" value={LEVEL_COUNT} label="maturity levels" />
        <div className="min-w-[16rem] flex-1">
          <p className="text-sm leading-relaxed text-slate-400">
            Every dimension comes back with evidence from the repository, a level, and a ranked route
            to the next one — plus a shareable report at this URL. No number is shown for this repo
            until a scan has actually produced one.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {DIMENSIONS.map((d) => (
          <DimensionChip key={d.id} id={d.id} name={d.name} />
        ))}
      </div>

      <div className="mt-5">
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
          The repository lands on one of these
        </div>
        <LevelLadder />
      </div>

      <div className="mt-6 border-t border-divider pt-5">
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Before you start</div>
        <ul className="space-y-1.5">
          <Term>
            <strong className="font-semibold text-slate-300">Free for public repositories</strong> — no
            account, no card. Free scans are capped at a few per month per visitor; past that you&apos;ll be
            asked to sign in for a higher allowance.
          </Term>
          <Term>
            <strong className="font-semibold text-slate-300">It takes minutes, not seconds.</strong> A scan
            runs a live model assessment of the repository, so plan for a few minutes and leave the tab
            open. It bills real model usage on our side, which is why the free allowance exists.
          </Term>
          <Term>
            <strong className="font-semibold text-slate-300">Nothing is cloned.</strong> The repository is
            read through the GitHub API; your code is never copied. The resulting report is public and is
            saved at this URL, so the link works for whoever you send it to.
          </Term>
        </ul>
      </div>

      <p className="mt-5 text-sm text-slate-400">
        Not ready to wait?{" "}
        <Link href={demoOrgHref()} className="focus-ring rounded text-accent underline-offset-4 hover:underline">
          Explore the live demo →
        </Link>{" "}
        <span className="text-slate-500">— {DEMO_ORG_NAME}, already scanned, in the real format.</span>
      </p>
    </Surface>
  );
}
