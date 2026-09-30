// One state cell of the control ledger, Prism. Status is a glyph and a word. Unreadable is a void,
// never a dash and never a zero. A descriptor prints its value and no verdict.
import { VoidMark } from "@/components/kit";
import { STATE_TITLE, type TimelineRow } from "./controlTimeline";

export function ControlStateV2({ row }: { row: TimelineRow }) {
  if (row.state === "unmeasurable") {
    return (
      <span className="inline-flex items-center gap-2 text-slate-400" title={STATE_TITLE.unmeasurable}>
        <VoidMark subject="Control state" label="Not measured" />
        <span>not measured</span>
      </span>
    );
  }
  if (row.descriptor) {
    return (
      <span className="text-slate-200" title="A descriptor, not a bar: this control reports a fact and can never fail.">
        {row.value ?? <VoidMark subject="Descriptor" label="Not measured" />}
      </span>
    );
  }
  const failing = row.state !== "pass";
  return (
    <div>
      <span className="text-slate-200" title={STATE_TITLE[row.state]}>
        <span aria-hidden className="mr-1.5">
          {failing ? "▲" : "✓"}
        </span>
        <span className="sr-only">{failing ? "At risk: " : "Healthy: "}</span>
        {failing ? "not operating" : "operating"}
        {row.value && row.value !== "true" && row.value !== "false" ? (
          <span className="text-slate-400"> · {row.value}</span>
        ) : null}
      </span>
      {row.failMeans ? <p className="mt-1 max-w-[26rem] type-body-sm text-slate-400">{row.failMeans}</p> : null}
    </div>
  );
}
