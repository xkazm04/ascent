"use client";

// Prism adoption ledger. Counts stay paper. Behind and drifted carry a glyph, not a hue.
import { ConfirmAction, batchPrConfirm } from "@/components/ConfirmAction";
import { Caption, Display, Frame, GhostAction, SectionHead } from "@/components/kit";
import { rolloutConfirmBody } from "./practiceAdoptionRows";
import { MAX_BATCH } from "./practiceApplyShared";
import { PracticeApplyBatchResults } from "./PracticeApplyBatchResults";
import { usePracticeDrift } from "./usePracticeDrift";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

const GLYPH: Record<string, { mark: string; word: string } | undefined> = {
  behind: { mark: "◆", word: "Watch" },
  drifted: { mark: "▲", word: "At risk" },
};

export function PracticeDriftV2({ slug, summary }: { slug: string; summary: PracticeAdoptionSummary }) {
  const d = usePracticeDrift(slug, summary);
  if (!d.meaningful) return null;
  const { tiles, confirming, setConfirming, targets, busy, error, results, meta, openConfirm, rollOut } = d;
  return (
    <Frame>
      <SectionHead
        eyebrow="Adoption ledger"
        title="What landed"
        named="is still there."
        lede="Adopted, behind an older house pattern, or drifted since it landed. An empty ledger is omitted, never drawn as three zeros."
      />
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
        {tiles.map((t) => {
          const tone = t.value > 0 ? GLYPH[t.bucket] : undefined;
          return (
            <div key={t.bucket}>
              <Caption>{t.label}</Caption>
              <Display as="div" level="figure">
                {tone && (
                  <>
                    <span aria-hidden className="mr-1.5 align-middle text-[0.45em]">{tone.mark}</span>
                    <span className="sr-only">{tone.word}: </span>
                  </>
                )}
                {t.value}
              </Display>
              <Caption>{t.sub}</Caption>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {tiles.filter((t) => t.rollout).map((t) => (
          <GhostAction key={t.bucket} disabled={busy} onClick={() => void openConfirm(t)}>
            Roll out to the {t.value} repo{t.value === 1 ? "" : "s"} behind
          </GhostAction>
        ))}
        {error && <p className="text-slate-400">{error}</p>}
      </div>
      <PracticeApplyBatchResults batchResults={results} batchSummary={meta} />
      <ConfirmAction
        open={confirming !== null}
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const tile = confirming;
          setConfirming(null);
          if (tile) void rollOut(tile);
        }}
        {...(confirming
          ? (() => {
              const spec = batchPrConfirm(targets.length, MAX_BATCH, slug);
              return { ...spec, body: rolloutConfirmBody(spec.body, confirming.rollout!.practiceId, targets) };
            })()
          : { title: "", body: "", confirmLabel: "", tone: "default" as const })}
      />
    </Frame>
  );
}
