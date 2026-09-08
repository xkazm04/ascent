// The Top blockers panel shell shared by the baseline and its prototype variants: one Surface + Kicker
// header + all-clear handling, so every variant swaps only the row treatment. The panel sits beside the
// scatter in a fixed grid, so an empty result renders an all-clear line rather than vanishing and
// leaving a dead column.
//
// /org redesign: the `intro` sentence ("Each solid mark is a blocked repo; each hollow one is a repo
// whose owner has accepted the gap…") became a `legend` slot. A sentence describing marks IS a legend
// wearing prose; the kit's `Legend` shows the marks themselves and carries the sentence as each row's
// hover/focus hint (docs/ORG-UX-REDESIGN.md §2.1 D).

import { Surface, Kicker } from "@/components/ui";

export function PassportBlockerShell({
  scopeLabel,
  legend,
  empty,
  children,
}: {
  scopeLabel: string;
  /** Symbol-first legend under the header (omitted in the all-clear state). */
  legend?: React.ReactNode;
  /** No blockers to rank — render the all-clear line instead of children. */
  empty?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Surface className="h-full p-4">
      <Kicker tone="muted">Top blockers · {scopeLabel}</Kicker>
      {empty ? (
        <p className="mt-3 type-body-sm text-emerald-400/80">No blockers on record for the repos in view.</p>
      ) : (
        <>
          {legend && <div className="mt-2">{legend}</div>}
          {children}
        </>
      )}
    </Surface>
  );
}
