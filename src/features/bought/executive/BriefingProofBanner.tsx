import { briefingLoopProofLine, briefingProofLine, type ExecBriefing } from "@/lib/org/briefing";

// The "Proof" banner — the practice-rollout numbers (starter PRs merged + measured post-merge lift)
// that answer "did acting on the last briefing's ask actually work". Sits right under the
// value-realized banner: same renewal-justification audience, same banner treatment, emerald accent
// so shipped-and-measured proof reads differently from in-period movement. Renders nothing when
// there's nothing in flight (briefingProofLine's contract) — never a "0 · 0" that reads as failure.
// Server-safe (no hooks); shared verbatim by the exec tab and the public share page so the two
// cannot drift, and the same line feeds the PDF + markdown via briefingProofLine.
//
// MOONSHOT #26 adds the LOOP's line beneath it, from `briefingLoopProofLine` — same null-is-absence
// rule, and deliberately a SECOND line rather than a longer first one: merged work and work sitting
// on an unreviewed branch are different claims, and the second says "on branches, not merged" in
// words. Both can be absent, either can be absent, and the banner disappears when both are.

export function BriefingProofBanner({ proof, loopProof, className = "" }: {
  proof: ExecBriefing["proof"];
  /** Optional so a caller that predates the union renders exactly what it always did. */
  loopProof?: ExecBriefing["loopProof"];
  className?: string;
}) {
  const line = briefingProofLine(proof ?? null);
  const loopLine = briefingLoopProofLine(loopProof ?? null);
  if (!line && !loopLine) return null;
  return (
    <div className={`rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] px-4 py-3 ${className}`}>
      {line && (
        <p>
          <span className="font-mono text-sm uppercase tracking-widest text-emerald-300">Proof: improvement shipped</span>{" "}
          <span className="text-base text-slate-200">{line}</span>{" "}
          <span className="font-mono text-xs text-slate-500">fleet-wide</span>
        </p>
      )}
      {loopLine && (
        <p className={line ? "mt-2" : undefined}>
          <span className="font-mono text-sm uppercase tracking-widest text-emerald-300">Local loop</span>{" "}
          <span className="text-base text-slate-200">{loopLine}</span>
        </p>
      )}
    </div>
  );
}
