// The page's one statement: how large the library is, and the four readings the tile row used to
// carry. An unmeasured reading is a void, never a zero. Numbers stay paper; no status hue.
import type { ReactNode } from "react";
import { CopyForLlm } from "@/components/CopyForLlm";
import { Masthead, VoidMark, type MastheadFigure } from "@/components/kit";
import { practiceFigures, practiceStatement } from "./practicesFigures";
import type { PracticesPageData } from "./practicesData";

function toFigure(f: ReturnType<typeof practiceFigures>[number]): MastheadFigure {
  return {
    label: f.label,
    value: f.unknown ? (
      <span className="inline-flex items-center gap-2">
        <VoidMark subject={f.label} label={`${f.label}: not measured`} />
        not measured
      </span>
    ) : (
      f.value
    ),
    detail: f.detail,
    tone: f.tone,
    title: f.title,
  };
}

export function PracticesMastheadV2({ data, filters }: { data: PracticesPageData; filters: ReactNode }) {
  const head = practiceStatement(data.summary);
  return (
    <Masthead
      pattern="spectral"
      eyebrow="Practices"
      statement={head.statement}
      named={head.named}
      lede={head.lede}
      figures={practiceFigures(data.summary).map(toFigure)}
      aside={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {filters}
          <CopyForLlm text={data.brief} label="Copy practice library brief for LLM" />
        </div>
      }
    />
  );
}
