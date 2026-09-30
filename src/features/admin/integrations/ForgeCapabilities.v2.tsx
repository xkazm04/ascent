// What GitLab can and cannot be asked. An unobservable signal is unmeasured, never missing and never zero.
import { Caption, CellMark } from "@/components/kit";
import { CAPABILITY_LABELS } from "./forgeCapabilityLabels";

export function ForgeCapabilitiesV2() {
  return (
    <div className="mt-6">
      <Caption>What Ascent can observe on GitLab</Caption>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {CAPABILITY_LABELS.map((row) => (
          <li key={row.key} className="min-w-0">
            <CellMark state={row.gitlab ? "met" : "unmeasured"}>{row.gitlab ? "observed" : "not observable"}</CellMark>
            <span className="mt-0.5 block type-body-sm text-slate-400">{row.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 type-body-sm text-slate-400">
        An unobservable signal is reported as unknown, never as zero, and no score is adjusted to compensate for it, so a GitLab repo is
        floored by what cannot be seen, not penalized for it.
      </p>
    </div>
  );
}
