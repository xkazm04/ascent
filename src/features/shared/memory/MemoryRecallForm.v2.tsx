"use client";

import { FormField, Input, PrimaryAction, Select } from "@/components/kit";
import { memoryKindLabel } from "@/lib/org/memory-kinds";

const MIN_BUDGET = 200;
const MAX_BUDGET = 60_000;

export function MemoryRecallFormV2({
  charBudget,
  setCharBudget,
  namespace,
  setNamespace,
  kind,
  setKind,
  namespaces,
  kinds,
  running,
  onRecall,
}: {
  charBudget: number;
  setCharBudget: (v: number) => void;
  namespace: string;
  setNamespace: (v: string) => void;
  kind: string;
  setKind: (v: string) => void;
  namespaces: string[];
  kinds: readonly string[];
  running: boolean;
  onRecall: () => void;
}) {
  return (
    <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <FormField label="Budget (chars)" htmlFor="recall-budget">
        <Input
          id="recall-budget"
          type="number"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={500}
          value={charBudget}
          onChange={(e) => setCharBudget(Number(e.target.value))}
        />
      </FormField>
      <FormField label="Namespace" htmlFor="recall-namespace">
        <Select id="recall-namespace" value={namespace} onChange={(e) => setNamespace(e.target.value)}>
          <option value="">all</option>
          {namespaces.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Kind" htmlFor="recall-kind">
        <Select id="recall-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">all</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {memoryKindLabel(k)}
            </option>
          ))}
        </Select>
      </FormField>
      <PrimaryAction onClick={onRecall} disabled={running}>
        {running ? "Recalling…" : "Recall"}
      </PrimaryAction>
    </div>
  );
}
