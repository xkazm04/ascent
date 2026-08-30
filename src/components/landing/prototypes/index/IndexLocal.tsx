// Local-loop section for The Index — the self-hosted capabilities the landing never mentioned.
//
// The pricing page already states the identity claim (SelfHostBand: the plans buy operation, not
// capability), but the landing said nothing about what actually ships for a self-hosted operator:
// repo↔folder pairing with scan-from-disk (src/lib/local/pairing.ts + source.ts), the autopilot
// improvement loop (src/lib/local/loop-engine.ts — worktree branch, never pushes), and the read-only
// MCP door (src/lib/mcp/). These only exist where Ascent runs beside the code it scores, which is
// precisely why a scan-the-cloud competitor cannot copy them — so they earn a deck section.
//
// Added 2026-08-28: the Loop Cockpit / drive-to-green band. The loop is what the product is FOR —
// "zero scores to L5, infinitely iterable" — and until now no marketing surface named it at all,
// neither here, nor on /about, nor on /about-org. Every number in it is imported from the module that
// enforces it (LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP, DRIVE_MAX_RUNS_CAP) rather than typed, so
// the band cannot outlive the caps it advertises.
//
// Every card's copy is checked against docs/features/local-mode/README.md and src/lib/mcp/tools.ts;
// keep it exactly true when either changes.

import Link from "next/link";
import { DeckSection } from "@/components/deck/DeckSection";
import { Kicker } from "@/components/ui";
import { sourceRepoHref } from "@/lib/site";
import { LOOP_CONCURRENCY_CAP, LOOP_MAX_CYCLES_CAP } from "@/lib/db/loop-runs-types";
import { DRIVE_MAX_RUNS_CAP, type DrivePhase } from "@/lib/local/drive-types";

interface LocalFeature {
  term: string;
  title: string;
  body: string;
}

/**
 * The loop's stages, named the way the cockpit names them, and its rope, imported from the modules
 * that enforce it — `LOOP_CONCURRENCY_CAP` / `LOOP_MAX_CYCLES_CAP` (src/lib/db/loop-runs-types.ts)
 * and `DRIVE_MAX_RUNS_CAP` (src/lib/local/drive-types.ts).
 *
 * Why the caps are the copy and not a footnote: the honest thing about this loop is that it is
 * BOUNDED. A marketing surface that says "it improves your repo until it's done" is selling an
 * open-ended agent, which is exactly what `drive.ts` was written not to be — it stops on `green`,
 * on `dry` (a whole run moved nothing) or on `ceiling`, and the measurement is a rescan, never the
 * agent's own word. Printing the numbers is what makes that claim checkable.
 */
const LOOP_STAGES = ["scan", "propose", "agent or foundation lane", "rescan", "drive to green"];

/** The three ways a drive ENDS BY POLICY (drive.ts's `decideNext`), typed against `DrivePhase` so a
 *  renamed or retired phase fails the build here instead of leaving the landing selling a stop
 *  condition the engine no longer has. The other phases — stopped, interrupted, error — are not
 *  outcomes of the policy and deliberately aren't advertised as such. */
const DRIVE_STOPS: DrivePhase[] = ["green", "dry", "ceiling"];

const LOOP_FACTS: Array<{ value: string; label: string }> = [
  { value: `${LOOP_CONCURRENCY_CAP}`, label: "lanes at once" },
  { value: `${LOOP_MAX_CYCLES_CAP}`, label: "cycles per run" },
  { value: `${DRIVE_MAX_RUNS_CAP}`, label: "runs per drive" },
  { value: `${DRIVE_STOPS.length}`, label: "ways it stops" },
];

// The three claims, each verified against the shipped code (see file header). "Unpushed commits
// included" is `git log` on the paired folder; "never pushes" is a loop-engine guardrail; the MCP
// tools are read-only by design with per-tool token scopes.
const LOCAL_FEATURES: LocalFeature[] = [
  {
    term: "Pairing",
    title: "Scan from your disk",
    body: "Point Ascent at the folder on your disk. It scans straight from git — unpushed commits included.",
  },
  {
    term: "Autopilot",
    title: "A loop that proposes",
    body: "The improvement loop runs your Claude CLI in an isolated worktree and leaves you a branch to review. It never pushes.",
  },
  {
    term: "MCP door",
    title: "Your agents can ask",
    body: "Coding agents ask Ascent directly — fleet standing, gate verdicts, open gaps — read-only, over token-scoped MCP.",
  },
];

export function IndexLocal() {
  // Same degrade rule as the hero and SelfHostBand: a real repository link when the deployment names
  // one, the in-repo path as plain text otherwise — never a guessed, dead URL.
  const guideHref = sourceRepoHref("docs/SELF-HOSTING.md");
  return (
    // No inner container: IndexVariant wraps the mid-deck sections in the editorial `deck-container`
    // shell (same as IndexOrg / IndexFleet).
    <DeckSection id="local">
      <div className="border-y border-divider py-8 2xl:py-10">
        <div className="max-w-2xl">
          <Kicker>The local loop</Kicker>
          <h2 className="deck-h2 mt-2 type-heading font-bold text-white">Runs where your code lives</h2>
          <p className="deck-body mt-2 type-body leading-relaxed text-slate-400">
            Self-host Ascent and it runs beside the code it scores — the same AGPL-3.0 codebase as the
            cloud, every tier switched on. That closes a loop no scan-the-cloud service can offer:
            score, improve, and verify, before anything is pushed.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3 2xl:gap-4">
          {LOCAL_FEATURES.map((f) => (
            <div key={f.term} className="flex flex-col rounded-xl border border-divider bg-surface-strong/40 p-5">
              <span className="type-label tracking-[0.22em] text-slate-500">{f.term}</span>
              <span className="mt-2 type-body font-semibold text-white">{f.title}</span>
              <span className="mt-2 type-body-sm leading-relaxed text-slate-400 2xl:type-body">{f.body}</span>
            </div>
          ))}
        </div>

        {/* The loop itself — the thing the brief calls the product's core, and the one surface the
            landing never mentioned. Every number below is imported from the module that enforces it,
            so this block cannot outlive the caps it advertises. */}
        <div className="mt-8 rounded-xl border border-accent/25 bg-accent/[0.04] p-5 2xl:p-6">
          <Kicker>Drive it to green</Kicker>
          <p className="deck-body mt-2 max-w-3xl type-body leading-relaxed text-slate-300">
            The cockpit runs the whole climb for you: it reads the open gaps, proposes a batch, works
            each repo in its own isolated worktree — a coding agent on the backlog, or a deterministic
            lane that installs the <code className="type-mono-sm text-slate-200">.ai/</code>{" "}
            foundation and practice starters — then rescans from disk and keeps going until the fleet
            clears the bar. What decides whether it landed is the rescan, never the agent&apos;s own
            report.
          </p>

          <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 type-label tracking-[0.18em] text-slate-400">
            {LOOP_STAGES.map((stage, i) => (
              <li key={stage} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden className="text-slate-700">
                    →
                  </span>
                )}
                <span className={i === LOOP_STAGES.length - 1 ? "text-accent" : undefined}>{stage}</span>
              </li>
            ))}
          </ol>

          <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-divider bg-divider sm:grid-cols-4">
            {LOOP_FACTS.map((f) => (
              <div key={f.label} className="bg-ink px-4 py-3">
                <dt className="font-mono type-micro uppercase tracking-[0.2em] text-slate-500">{f.label}</dt>
                <dd className="mt-1 font-mono type-title font-bold tabular-nums text-white">{f.value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 type-body-sm leading-relaxed text-slate-500">
            Bounded on purpose. A drive ends exactly three ways —{" "}
            <span className="font-mono text-slate-400">{DRIVE_STOPS.join(" · ")}</span> — every repo in
            scope cleared the bar, a whole run moved nothing, or the rope ran out. Never because
            something decided it was finished. Self-hosted only, owner-gated, and it never pushes: what
            you get back is a branch.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/pricing#self-host" className="type-body-sm font-medium text-slate-300 transition hover:text-white">
            Free forever — what self-hosting includes →
          </Link>
          {guideHref ? (
            <a
              href={guideHref}
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded-sm type-label tracking-widest text-slate-400 transition hover:text-accent"
            >
              <span aria-hidden>▸</span> Self-hosting guide
            </a>
          ) : (
            <span className="type-label tracking-widest text-slate-500">
              Self-hosting guide: <span className="text-slate-400">docs/SELF-HOSTING.md</span>
            </span>
          )}
        </div>
      </div>
    </DeckSection>
  );
}
