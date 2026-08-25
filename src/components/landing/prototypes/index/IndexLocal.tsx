// Local-loop section for The Index — the self-hosted capabilities the landing never mentioned.
//
// The pricing page already states the identity claim (SelfHostBand: the plans buy operation, not
// capability), but the landing said nothing about what actually ships for a self-hosted operator:
// repo↔folder pairing with scan-from-disk (src/lib/local/pairing.ts + source.ts), the autopilot
// improvement loop (src/lib/local/loop-engine.ts — worktree branch, never pushes), and the read-only
// MCP door (src/lib/mcp/). These only exist where Ascent runs beside the code it scores, which is
// precisely why a scan-the-cloud competitor cannot copy them — so they earn a deck section.
//
// Every card's copy is checked against docs/features/local-mode/README.md and src/lib/mcp/tools.ts;
// keep it exactly true when either changes.

import Link from "next/link";
import { DeckSection } from "@/components/deck/DeckSection";
import { Kicker } from "@/components/ui";
import { sourceRepoHref } from "@/lib/site";

interface LocalFeature {
  term: string;
  title: string;
  body: string;
}

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
          <h2 className="deck-h2 mt-2 text-2xl font-bold text-white">Runs where your code lives</h2>
          <p className="deck-body mt-2 text-base leading-relaxed text-slate-400">
            Self-host Ascent and it runs beside the code it scores — the same AGPL-3.0 codebase as the
            cloud, every tier switched on. That closes a loop no scan-the-cloud service can offer:
            score, improve, and verify, before anything is pushed.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3 2xl:gap-4">
          {LOCAL_FEATURES.map((f) => (
            <div key={f.term} className="flex flex-col rounded-xl border border-divider bg-surface-strong/40 p-5">
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">{f.term}</span>
              <span className="mt-2 text-base font-semibold text-white">{f.title}</span>
              <span className="mt-2 text-sm leading-relaxed text-slate-400 2xl:text-base">{f.body}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/pricing#self-host" className="text-sm font-medium text-slate-300 transition hover:text-white">
            Free forever — what self-hosting includes →
          </Link>
          {guideHref ? (
            <a
              href={guideHref}
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded-sm font-mono text-xs uppercase tracking-widest text-slate-400 transition hover:text-accent"
            >
              <span aria-hidden>▸</span> Self-hosting guide
            </a>
          ) : (
            <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
              Self-hosting guide: <span className="text-slate-400">docs/SELF-HOSTING.md</span>
            </span>
          )}
        </div>
      </div>
    </DeckSection>
  );
}
