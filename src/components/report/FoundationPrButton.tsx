"use client";

// "Install .ai/ foundation" — the one-click install path for the AI-Native Standard. POSTs to
// /api/report/foundation/pr, which seeds the generated .ai/ tree onto one branch and opens a single
// draft PR (see src/lib/standard/pr.ts for the collision policy). Renders ONLY for a signed-in org
// member of a non-public repo (the page resolves that server-side and threads it down) — the route
// re-checks everything, so this gate is a UX courtesy, not the security boundary.
//
// Deliberately mirrors the SKILL.md pill row's chrome (pillClass) and keeps its whole lifecycle in
// one control: idle → opening… → "PR #N →" (a link, since the PR is the deliverable) or a terse
// error with the route's message. A reused PR is the same success — the branch is stable, so a
// re-click updates the existing install PR rather than opening a second one.

import { useState } from "react";
import { pillClass } from "@/components/report/pill";

type PrState =
  | { phase: "idle" }
  | { phase: "opening" }
  | { phase: "done"; url: string; number: number; skipped: string[] }
  | { phase: "error"; message: string };

export function FoundationPrButton({ repo }: { repo: string }) {
  const [state, setState] = useState<PrState>({ phase: "idle" });

  const open = async () => {
    setState({ phase: "opening" });
    try {
      const res = await fetch("/api/report/foundation/pr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        number?: number;
        skipped?: string[];
        error?: string;
      };
      if (!res.ok || !data.url || typeof data.number !== "number") {
        // 409 on the spine means the standard is already installed — say that, not "error".
        const msg =
          res.status === 409 ? "Already installed (.ai/manifest.yaml exists)" : (data.error ?? `Failed (HTTP ${res.status})`);
        setState({ phase: "error", message: msg });
        return;
      }
      setState({ phase: "done", url: data.url, number: data.number, skipped: data.skipped ?? [] });
    } catch {
      setState({ phase: "error", message: "Network error. Try again." });
    }
  };

  if (state.phase === "done") {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noreferrer"
        className={pillClass({ accent: true, focusRing: true, textSm: true })}
        title={
          state.skipped.length
            ? `Draft PR opened. Skipped pre-existing: ${state.skipped.join(", ")}`
            : "Draft PR opened: review and merge to install the .ai/ foundation"
        }
      >
        <span aria-hidden>⇡</span> Foundation PR #{state.number} →
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={state.phase === "opening"}
      className={pillClass({ focusRing: true, textSm: true })}
      title="Open a draft PR that seeds the generated .ai/ foundation (manifest, doctor, guardrails, memory, CONTEXT) into this repo"
    >
      {state.phase === "opening" ? (
        "Opening PR…"
      ) : state.phase === "error" ? (
        <span className="text-amber-400">{state.message}</span>
      ) : (
        <>
          <span aria-hidden>⇡</span> Install .ai/ foundation
        </>
      )}
    </button>
  );
}
