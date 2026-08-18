import { briefingProofLine, type ExecBriefing } from "@/lib/org/briefing";

// The "Proof" banner — the practice-rollout numbers (starter PRs merged + measured post-merge lift)
// that answer "did acting on the last briefing's ask actually work". Sits right under the
// value-realized banner: same renewal-justification audience, same banner treatment, emerald accent
// so shipped-and-measured proof reads differently from in-period movement. Renders nothing when
// there's nothing in flight (briefingProofLine's contract) — never a "0 · 0" that reads as failure.
// Server-safe (no hooks); shared verbatim by the exec tab and the public share page so the two
// cannot drift, and the same line feeds the PDF + markdown via briefingProofLine.

export function BriefingProofBanner({ proof, className = "" }: { proof: ExecBriefing["proof"]; className?: string }) {
  const line = briefingProofLine(proof ?? null);
  if (!line) return null;
  return (
    <div className={`rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] px-4 py-3 ${className}`}>
      <span className="font-mono text-sm uppercase tracking-widest text-emerald-300">Proof: improvement shipped</span>{" "}
      <span className="text-base text-slate-200">{line}</span>{" "}
      <span className="font-mono text-xs text-slate-500">fleet-wide</span>
    </div>
  );
}
