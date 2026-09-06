"use client";

// token-enforcement: the gate over a fictional codebase sized by the volume knob. Every finding
// names the equivalent it should have used; the severity picker is the design decision (warn
// enforces nothing at any gate by construction; error fails; ratchet baselines the debt and fails on
// increase); "inline a raw value" is the deadline commit, "suppress it" the loud, countable escape
// hatch. Ten suppressions is a policy; a hundred is a dialect.

import { useMemo, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { codebaseFor } from "./fixtures";
import { scan, suppressionPosture, verdict, type Severity } from "./lint";
import { Choice, Readout, Region, BTN } from "./sceneParts";

export function EnforcementRegion({ volume }: { volume: SurfaceVolume }) {
  const [severity, setSeverity] = useState<Severity>("warn");
  const [added, setAdded] = useState(0);
  const [suppressedExtra, setSuppressedExtra] = useState(0);
  const findings = useMemo(() => scan(codebaseFor(volume)), [volume]);
  const baseline = findings.filter((f) => !f.suppressed).length; // the debt snapshotted when the ratchet was wired
  const suppressed = findings.filter((f) => f.suppressed).length + suppressedExtra;
  const open = baseline + added - suppressedExtra;
  const v = verdict(open, severity, baseline);
  const posture = suppressionPosture(suppressed);
  return (
    <Region technique="token-enforcement" title="The gate, or decay" note="Raw values with a semantic equivalent are findings, and each finding names the equivalent.">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-1">
          <Readout label="files scanned" value={volume.toLocaleString()} />
          <Readout label="findings (open)" value={<span data-open={open}>{open.toLocaleString()}</span>} />
          <Readout label="suppressions" value={<span data-suppressions={suppressed}>{`${suppressed.toLocaleString()} (${posture})`}</span>} tone={posture === "dialect" ? "text-danger" : posture === "watch" ? "text-warn" : "text-slate-200"} />
          <div className="pt-1">
            <Choice label="severity" value={severity} options={["warn", "error", "ratchet"] as const} onChange={setSeverity} />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className={BTN} onClick={() => setAdded((n) => n + 1)}>
              inline a raw value
            </button>
            <button type="button" className={BTN} disabled={open === 0} onClick={() => setSuppressedExtra((n) => n + 1)}>
              suppress one inline
            </button>
          </div>
          <Readout label="build" value={<span data-build={v.passes ? "pass" : "fail"}>{v.line}</span>} tone={v.passes ? (severity === "warn" && open > 0 ? "text-warn" : "text-success-soft") : "text-danger"} />
        </div>
        <ul className="space-y-1 type-caption">
          {findings.slice(0, 4).map((f, i) => (
            <li key={i} className="rounded-md border border-divider p-2">
              <p className="font-mono text-slate-400">{f.file}</p>
              <p className="text-slate-300">
                <span className="text-danger">{f.raw}</span> has an equivalent: <span className="text-slate-200">{f.equivalent}</span>
              </p>
              {f.suppressed ? <p className="text-slate-500">suppressed inline, with its reason, and counted</p> : null}
            </li>
          ))}
          <li className="text-slate-600">{findings.length > 4 ? `and ${(findings.length - 4).toLocaleString()} more; the gate is an allow-list against the vocabulary, not a list of remembered offenders` : "the gate is an allow-list against the vocabulary"}</li>
        </ul>
      </div>
    </Region>
  );
}
