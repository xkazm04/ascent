"use client";

// LESSONS KEPT BY THE RUNNER — the one place the operator SEES what the unattended runner decided the
// organization should believe (a verified lane keeps its own lessons into Org Memory at the "probable,
// unverified" confidence), and takes any of them back. Revoke archives the memory — out of every brief
// from the next lane on — and records who revoked it. Owner-only: it overrules a delegation the owner made.

import { useState } from "react";
import { InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { fmtAgo, shortRepo } from "./ledgerFormat";
import { revokeLesson } from "./ledgerClient";
import { LEDGER_ANCHOR } from "./ledgerModel";
import type { RunnerKeptLessonRow } from "./ledgerTypes";

const STATE: Record<string, { text: string; tone: string }> = {
  kept: { text: "in memory", tone: "text-success-soft" },
  revoked: { text: "revoked", tone: "text-slate-500" },
  archived: { text: "archived elsewhere", tone: "text-slate-500" },
};

export function RunnerLessons({
  slug,
  lessons,
  now,
  isOwner,
  onRevoked,
}: {
  slug: string;
  /** Null = the read failed. */
  lessons: readonly RunnerKeptLessonRow[] | null;
  now: string;
  isOwner: boolean;
  onRevoked: (row: RunnerKeptLessonRow) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const revoke = async (id: string) => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      onRevoked(await revokeLesson(slug, id));
    } catch (e) {
      setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : "Could not revoke that lesson." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id={LEDGER_ANCHOR.lessons} aria-labelledby="ledger-lessons-h" className="scroll-mt-24 space-y-3">
      <SectionHeader
        title={<span id="ledger-lessons-h">Lessons kept by the runner</span>}
        description={`A lane whose work was verified keeps its own lessons in Org Memory, marked as probable and unverified. ${
          isOwner ? "Revoke any you disagree with." : "An owner can revoke any of them."
        }`}
      />
      {lessons == null ? (
        <p role="alert" className="type-body-sm text-warn">
          Could not read the runner&apos;s lessons.
        </p>
      ) : lessons.length === 0 ? (
        <InlineEmpty>The runner has kept no lessons yet.</InlineEmpty>
      ) : (
        <ul className="divide-y divide-divider rounded-2xl border border-divider">
          {lessons.map((l) => {
            const s = STATE[l.state] ?? STATE.kept!;
            return (
              <li key={l.id} data-testid="runner-lesson" className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className={`type-body-sm ${l.state === "kept" ? "text-slate-200" : "text-slate-500 line-through"}`}>{l.content}</p>
                  <p className="type-caption text-slate-500">
                    {l.repo ? shortRepo(l.repo) : "org-wide"} · kept {fmtAgo(l.keptAt, now)} · <span className={s.tone}>{s.text}</span>
                    {l.state === "revoked" && l.revokedBy ? ` by ${l.revokedBy}` : ""}
                  </p>
                  {errors[l.id] && (
                    <p role="alert" className="type-caption text-danger">
                      {errors[l.id]}
                    </p>
                  )}
                </div>
                {l.state === "kept" && isOwner && (
                  <button
                    type="button"
                    onClick={() => void revoke(l.id)}
                    disabled={busy !== null}
                    className="focus-ring shrink-0 rounded-lg border border-danger/50 px-3 py-1 type-caption text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    {busy === l.id ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
