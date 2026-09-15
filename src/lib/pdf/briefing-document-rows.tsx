// Row + heading primitives for the briefing PDF. Extracted from briefing-document.tsx to keep that
// file under the repo's 300-LOC .tsx cap (AGENTS.md) — pure relocation, no behavior change; the
// styles they read are re-declared here because StyleSheet.create returns opaque ids, not classes.

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { BriefingDim, BriefingMove } from "@/lib/org/briefing";
import { baseStyles, scoreColor } from "./theme";

const styles = StyleSheet.create({
  dimRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  moveRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
});

// G5-06: `wrap={false}` was previously applied only to the goal row, so a content-rich briefing could
// split a dimension/movement row's label from its value across a page break. Both row components now
// get the same unsplittable-row treatment as the goal row.
export function DimLine({ d }: { d: BriefingDim }) {
  return (
    <View style={styles.dimRow} wrap={false}>
      <Text>{d.dimId} · {d.label}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold", color: scoreColor(d.avg) }}>{d.avg}/100</Text>
    </View>
  );
}

export function MoveLine({ tone, m }: { tone: "up" | "down"; m: BriefingMove }) {
  const color = tone === "up" ? "#16a34a" : "#d97706";
  return (
    <View style={styles.moveRow} wrap={false}>
      <Text>{tone === "up" ? "+ " : "- "}{m.name}{m.levelFrom !== m.levelTo ? ` (${m.levelFrom} -> ${m.levelTo})` : ""}</Text>
      <Text style={{ fontFamily: "Helvetica-Bold", color }}>{m.dOverall >= 0 ? "+" : ""}{m.dOverall}</Text>
    </View>
  );
}

// G5-06: a section heading (with its preceding rule) had no protection against being stranded alone
// at the bottom of a page while every row under it was pushed to the next — `wrap={false}` keeps the
// rule+heading together as one block, and `minPresenceAhead` refuses to place that block at all unless
// there's room left for at least the start of its first row, so the whole block moves to the next page
// together instead of splitting.
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <View wrap={false} minPresenceAhead={28}>
      <View style={baseStyles.rule} />
      <Text style={baseStyles.sectionH}>{children}</Text>
    </View>
  );
}

// Same orphan protection as SectionHeading, minus the rule — for headings inside the Strengths/
// Weakest-dimensions two-column layout, where the rule is shared above both columns rather than
// per-column.
export function ColumnHeading({ children }: { children: ReactNode }) {
  return (
    <View wrap={false} minPresenceAhead={20}>
      <Text style={baseStyles.sectionH}>{children}</Text>
    </View>
  );
}

