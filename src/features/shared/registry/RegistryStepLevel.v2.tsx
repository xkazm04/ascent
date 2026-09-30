"use client";

import { useEffect, useRef } from "react";
import { EscBack, HairlineList, LevelNav, ListRow } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import { STEP_READ } from "./registryLadder";
import type { RegistryStep } from "./registryModel";
import { RegistryStepActions } from "./RegistryStepActions.v2";

export function RegistryStepLevel({
  view,
  slug,
  step,
  steps,
  onOpen,
  onClose,
}: {
  view: RegistryView;
  slug: string;
  step: RegistryStep;
  steps: readonly RegistryStep[];
  onOpen: (id: RegistryStep["id"]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [step.id]);
  const i = steps.findIndex((s) => s.id === step.id);
  const prev = i > 0 ? steps[i - 1] : undefined;
  const next = i >= 0 && i < steps.length - 1 ? steps[i + 1] : undefined;
  return (
    <div ref={ref} tabIndex={-1} data-role="registry-level" className="mt-6 space-y-4 outline-none">
      <EscBack onBack={onClose} />
      <LevelNav
        trail={[{ label: "Registry" }, { label: step.title }]}
        back={{ label: "All steps", onClick: onClose }}
        prev={prev ? { label: prev.title, onClick: () => onOpen(prev.id) } : undefined}
        next={next ? { label: next.title, onClick: () => onOpen(next.id) } : undefined}
      />
      <HairlineList className="list-none">
        <ListRow
          selected
          onPress={onClose}
          leading={String(step.n).padStart(2, "0")}
          title={step.title}
          detail={step.detail}
          trailing={<span className="type-body-sm text-slate-400">{STEP_READ[step.state]}</span>}
        />
      </HairlineList>
      <p className="max-w-2xl type-body-sm text-slate-400">{step.blurb}</p>
      <RegistryStepActions view={view} slug={slug} step={step} />
    </div>
  );
}
