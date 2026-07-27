"use client";

// "Guard it in CI" — the free, unauthenticated maturity gate, rendered beside the badge generator so
// its snippets interpolate the SAME repo the user just typed and this deployment's real origin. The
// old server-rendered section printed `<ASCENT_URL>/<owner>/<repo>` placeholders — on a page whose
// whole promise is "copy the snippet", the copied command failed as-is (UX review 2026-07-27).

import { useState } from "react";
import { attemptCopy, nextCopyState } from "@/components/copy-for-llm.logic";

/** Copy affordance matching BadgeGenerator's: success only when the clipboard write resolves; on
 *  failure an honest "select & copy manually" hint (the snippet stays selectable in its <pre>). */
function CopyButton({ text, subject }: { text: string; subject: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    const ok = await attemptCopy(text, navigator.clipboard, () => false);
    const { next, resetMs } = nextCopyState(ok);
    setCopyState(next);
    setTimeout(() => setCopyState("idle"), resetMs);
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy the ${subject}`}
      className="focus-ring rounded-md border border-slate-700 px-2.5 py-1 font-mono text-xs uppercase tracking-widest text-slate-400 transition hover:border-accent hover:text-accent"
    >
      {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Select & copy" : "Copy"}
    </button>
  );
}

export function GateSection({
  yaml,
  query,
  repo,
}: {
  yaml: string;
  /** Gate-URL query string for the SAME policy as `yaml` — both derived from one policy server-side
   *  (describeGatePolicy), so the curl line and the workflow can't advertise different bars. */
  query: string;
  repo: { owner: string; repo: string } | null;
}) {
  // Origin is only known client-side (same seam as the badge snippet above this section).
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const ref = repo ? `${repo.owner}/${repo.repo}` : "<owner>/<repo>";
  // A runnable command, not a bare "GET <url>" description — `curl --fail` exits non-zero on the
  // 422 fail verdict, so this line IS the CI gate.
  const curl = `curl --fail "${origin}/api/gate/${ref}?${query}"`;

  return (
    <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="text-lg font-semibold text-white">The AI-native Scorecard gate — free, no account needed</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        The same maturity read behind the badge is available as a free, unauthenticated gate your
        pipeline can call on every PR: 200 = pass, 422 = fail, so <code className="font-mono">curl --fail</code>{" "}
        exits non-zero and blocks the merge. By default it scores with the deterministic rubric — no
        LLM, fully reproducible, the same inputs always produce the same verdict.
      </p>
      {/* The strongest reason to turn this on, and it was stated on no gate surface: the Security (D9)
          floor in the snippets below is scored VERBATIM from the security check battery — the one
          dimension the language model can only narrate, never move. */}
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        The Security floor in these snippets is stronger still: Security (D9) is the one{" "}
        <strong className="font-medium text-slate-300">fully deterministic</strong> dimension — its
        score comes straight from the security check battery, and no model can talk a repo past it.
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Gate API</div>
            <CopyButton text={curl} subject="gate command" />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-300">
            {curl}
            {"\n"}<span className="text-slate-500"># 200 = pass · 422 = fail{repo ? "" : " — enter a repository above to fill in the repo"}</span>
          </pre>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-xs uppercase tracking-widest text-slate-500">GitHub Action</div>
            <CopyButton text={yaml} subject="workflow snippet" />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-300">{yaml}</pre>
        </div>
      </div>
    </section>
  );
}
