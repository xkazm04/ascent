// The Top blockers panel shell shared by the baseline and its prototype variants: one Surface + Kicker
// header + all-clear handling, so every variant swaps only the row treatment. The panel sits beside the
// scatter in a fixed grid, so an empty result renders an all-clear line rather than vanishing and
// leaving a dead column.

import { Surface, Kicker } from "@/components/ui";

export function PassportBlockerShell({
  scopeLabel,
  intro,
  empty,
  children,
}: {
  scopeLabel: string;
  /** One-line explainer under the header (omitted in the all-clear state). */
  intro?: string;
  /** No blockers to rank — render the all-clear line instead of children. */
  empty?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Surface className="h-full p-4">
      <Kicker tone="muted">Top blockers · {scopeLabel}</Kicker>
      {empty ? (
        <p className="mt-3 text-sm text-emerald-400/80">No blockers on record for the repos in view.</p>
      ) : (
        <>
          {intro && <p className="mt-1 text-sm text-slate-500">{intro}</p>}
          {children}
        </>
      )}
    </Surface>
  );
}
