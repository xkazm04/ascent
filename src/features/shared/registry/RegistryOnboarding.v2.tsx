"use client";

// The six steps, always all six. A row opens #step-<id> in place; the rest of the tab stays.

import { Caption, Frame, HairlineList, Ladder, ListRow, SectionHead } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import { STEP_READ, ladderSteps, stepHasAction } from "./registryLadder";
import { registrySteps } from "./registryModel";
import { RegistryStepActions } from "./RegistryStepActions.v2";
import { RegistryStepLevel } from "./RegistryStepLevel.v2";
import { useRegistryLevel } from "./useRegistryLevel";

export function RegistryOnboarding({ view, slug }: { view: RegistryView; slug: string }) {
  const level = useRegistryLevel();
  const steps = registrySteps(view);
  const open = steps.find((s) => s.id === level.id) ?? null;
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const identified = view.status !== "unmapped";
  const settled = steps.every((s) => s.state === "done" || s.state === "skipped");
  return (
    <Frame>
      <SectionHead
        eyebrow={identified ? "Wiring the registry" : "Setting up the registry"}
        title="Six steps,"
        named="any order."
        lede="Each step reads its own evidence, so a reload lands in the same place."
        actions={
          <Caption>
            <span className="tabular-nums text-slate-200">{done}</span>/{steps.length} complete
          </Caption>
        }
      />
      {open ? (
        <RegistryStepLevel view={view} slug={slug} step={open} steps={steps} onOpen={level.open} onClose={level.close} />
      ) : (
        <>
          <Ladder steps={ladderSteps(view)} label="Registry setup" className="mt-6" />
          {settled ? (
            <p className="mt-4 max-w-2xl type-body-sm text-slate-400">
              Every step is done. The registry indexes itself, the fleet syncs against the catalog, and invokes are reporting back.
            </p>
          ) : null}
          <div className="mt-4 space-y-4">
            {steps.filter((s) => stepHasAction(view, s)).map((s) => (
              <div key={s.id} className="space-y-2">
                <Caption>{s.title}</Caption>
                <RegistryStepActions view={view} slug={slug} step={s} />
              </div>
            ))}
          </div>
          <HairlineList as="ol" className="mt-4 list-none">
            {steps.map((s) => (
              <ListRow
                key={s.id}
                onPress={() => level.open(s.id)}
                leading={String(s.n).padStart(2, "0")}
                title={s.title}
                detail={s.detail}
                trailing={<span className="type-body-sm text-slate-400">{STEP_READ[s.state]}</span>}
              />
            ))}
          </HairlineList>
        </>
      )}
    </Frame>
  );
}
