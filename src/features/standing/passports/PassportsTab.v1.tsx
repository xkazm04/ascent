// The Altimeter composition of the Passports tab, moved from PassportsTab. The scope controls (segment
// selector, CSV export) are built once by the entry and passed in, so this markup matches the previous
// header. Server-safe: the entry calls it as a function.
import type { ReactNode } from "react";
import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { PassportsSwitcher } from "./PassportsSwitcher";
import type { PassportsData } from "./passportData";

export function passportsV1(d: PassportsData): ReactNode {
  const { slug, rows, autonomy, capabilities, rollout, decisions, scope } = d;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title="Readiness passports" />
        <div className="flex flex-wrap items-center gap-2">{scope}</div>
      </div>

      {rows.length === 0 ? (
        <SectionEmpty>
          No passports yet for this view. Passports are produced by scans, so scan some of this org&apos;s repositories (or widen the segment filter), and each scan adds its repo here.
        </SectionEmpty>
      ) : (
        <PassportsSwitcher rows={rows} autonomy={autonomy} capabilities={capabilities} rollout={rollout} org={slug} decisions={decisions} />
      )}
    </div>
  );
}
