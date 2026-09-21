// ONE LINE NAMING WHAT IS ARMED — the setup dialog's footer and the masthead gear's title read the same
// words, so closing the dialog does not mean losing sight of what was set. Pure, so the line is pinned
// without a renderer. `RunSetupModal` re-exports `dialsSummary`, the name every caller imports.

import { parseCeilingUsd } from "./startInputs";
import type { RunDials } from "./useRunDials";

const per = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The runner's line: scope, ceiling and the forced settings, in the words the dialog uses. */
export function runnerSummary(d: RunDials): string {
  const c = parseCeilingUsd(d.spendCeiling);
  return [
    "standing runner",
    d.runnerScope === "all" ? "every watched, paired repo" : "the selection",
    !c.ok ? "ceiling not set" : c.usd === 0 ? "no spend ceiling" : `$${c.usd}/day ceiling`,
    `${per(d.batchSize, "item")}/lane`,
    per(d.concurrency, "lane"),
    per(d.cycles, "cycle"),
    d.model ?? "default model",
    d.effort ? `${d.effort} effort` : "default effort",
    "verified",
    "runner branch",
  ].join(" · ");
}

export function dialsSummary(d: RunDials): string {
  if (d.mode === "runner") return runnerSummary(d);
  return [
    d.dimFocus ? `focus ${d.dimFocus}` : "all dimensions",
    `${per(d.batchSize, "item")}/lane`,
    per(d.concurrency, "lane"),
    per(d.cycles, "cycle"),
    d.model ?? "default model",
    d.effort ? `${d.effort} effort` : "default effort",
    d.verifyMode === "on" ? "verified" : "unverified",
    d.delivery,
    // Named only when it departs from the default, and only where it is sent (a drive's dials).
    d.mode === "drive" && d.rescanCadence === "run" ? "one rescan per run" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
