"use client";

// THE HELD COMMITS, WHERE THE REVIEWER DECIDES (challenge-2026-09-23, card live-war-room#B). A held
// plan's work already exists — the fence parked it on `ascent/held/<plan>` — and approving the plan now
// lands exactly those commits. So the review shows them inline: the commit count and every file with
// its +/- line counts, read from `GET /api/org/loop/plans/[id]` (`hitl-approval/oracle-before-gate`).
//
// NEVER AN EMPTY LIST. A failed read says so in words, and the copy-a-command fallback is always here
// — the terminal is still the full diff, and the only view left when the paired checkout is not.

import { useEffect, useState } from "react";
import type { HeldDiff as HeldDiffData } from "@/lib/local/lane-adopt";
import { RUNNER_BRANCH } from "@/lib/local/runner-types";
import { CopyCommand } from "./CopyCommand";
import { fetchHeldDiff } from "./ledgerClient";
import { heldLogCommand } from "./ledgerModel";

type Read = { kind: "loading" } | { kind: "ok"; diff: HeldDiffData } | { kind: "failed"; message: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Count({ n, sign, tone }: { n: number | null; sign: "+" | "−"; tone: string }) {
  return <span className={`font-mono type-caption ${tone}`}>{n == null ? "bin" : `${sign}${n}`}</span>;
}

export function HeldDiff({ planId, heldBranch }: { planId: string; heldBranch: string }) {
  const [read, setRead] = useState<Read>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const diff = await fetchHeldDiff(planId);
        if (live) setRead({ kind: "ok", diff });
      } catch (e) {
        if (live) setRead({ kind: "failed", message: e instanceof Error ? e.message : "the read failed" });
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [planId]);

  const added = read.kind === "ok" ? read.diff.files.reduce((s, f) => s + (f.added ?? 0), 0) : 0;
  const deleted = read.kind === "ok" ? read.diff.files.reduce((s, f) => s + (f.deleted ?? 0), 0) : 0;
  return (
    <div data-testid="held-diff" className="mt-2 space-y-2">
      {read.kind === "loading" && <p className="type-caption text-slate-500">Reading the held branch…</p>}
      {read.kind === "failed" && (
        <p role="status" className="type-body-sm text-warn">
          Could not read the held branch — {read.message.replace(/\.$/, "")}. Read the commits in a terminal instead:
        </p>
      )}
      {read.kind === "ok" && (
        <>
          <p className="type-caption text-slate-400">
            {plural(read.diff.commits, "commit")} · {plural(read.diff.files.length, "file")} ·{" "}
            <Count n={added} sign="+" tone="text-success-soft" /> <Count n={deleted} sign="−" tone="text-danger-soft" />
          </p>
          {read.diff.files.length === 0 ? (
            <p className="type-body-sm text-slate-500">The held branch changes no file against {RUNNER_BRANCH}.</p>
          ) : (
            <ul data-testid="held-diff-files" className="max-h-60 space-y-0.5 overflow-auto rounded-md border border-divider px-3 py-2">
              {read.diff.files.map((f) => (
                <li key={f.path} className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate font-mono type-caption text-slate-200" title={f.path}>
                    {f.path}
                  </span>
                  <Count n={f.added} sign="+" tone="text-success-soft" />
                  <Count n={f.deleted} sign="−" tone="text-danger-soft" />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <CopyCommand lines={[heldLogCommand(heldBranch)]} />
    </div>
  );
}
