// The token gate (token-enforcement). No React. A raw value with a semantic equivalent is a finding,
// and the finding NAMES the equivalent (ban + pointer). The check is an allow-list shape: a value is
// raw when it is a literal (px, ms, hex) rather than a member of the vocabulary. Severity is the
// design decision: `warn` enforces nothing at any gate by construction; `error` fails the build;
// `ratchet` baselines the debt and fails on increase. Suppressions are countable.

import { SUPPRESSION, type SourceLine } from "./fixtures";

export type Severity = "warn" | "error" | "ratchet";
export type Violation = { file: string; raw: string; equivalent: string; suppressed: boolean };

const RULES: readonly { test: RegExp; equivalent: string }[] = [
  { test: /text-\[\d+px\]/, equivalent: "type-caption (the recipe, not a size)" },
  { test: /#[0-9a-f]{6}/i, equivalent: "a color role: surface, border, foreground" },
  { test: /rounded-\[\d+px\]/, equivalent: "rounded-card or rounded-interactive (the radius ladder)" },
  { test: /duration-\[\d+ms\]/, equivalent: "duration-base (the ladder; 187ms is between steps)" },
];

export function scan(lines: readonly SourceLine[]): Violation[] {
  const out: Violation[] = [];
  for (const line of lines) {
    const suppressed = line.classes.includes(SUPPRESSION);
    for (const rule of RULES) {
      const m = rule.test.exec(line.classes);
      if (m) out.push({ file: line.file, raw: m[0], equivalent: rule.equivalent, suppressed });
    }
  }
  return out;
}

export type GateVerdict = { passes: boolean; line: string };

/**
 * What the build does with `open` unsuppressed findings. `baseline` is the count snapshotted when
 * the ratchet was wired; the ratchet fails on increase and burns down opportunistically.
 */
export function verdict(open: number, severity: Severity, baseline: number): GateVerdict {
  if (severity === "warn") return { passes: true, line: `build passes with ${open.toLocaleString()} warnings: nothing enforced` };
  if (severity === "error") return open === 0 ? { passes: true, line: "build passes: zero raw values" } : { passes: false, line: `build fails: ${open.toLocaleString()} raw values with equivalents` };
  return open > baseline
    ? { passes: false, line: `build fails: ${open.toLocaleString()} exceeds the ${baseline.toLocaleString()} baseline` }
    : { passes: true, line: `build passes: ${open.toLocaleString()} of ${baseline.toLocaleString()} baseline, burning down` };
}

/** Ten is a policy; three hundred is a dialect. */
export function suppressionPosture(count: number): "policy" | "watch" | "dialect" {
  return count <= 10 ? "policy" : count < 100 ? "watch" : "dialect";
}
