// Shared light-theme scaffolding for the three @react-pdf report documents (report-document.tsx,
// briefing-document.tsx, security-document.tsx): the palette, the score-band color, the style
// fragments that are byte-identical across the docs, and the Stat / page-number Footer components.
//
// IMPORTANT — visual identity must not change. Only values that are identical across the docs that
// use them are hoisted here; where a doc legitimately differs (report-document uses h1 fontSize 22
// and rule marginVertical 16 vs 24/14 in the other two), that doc keeps its own local override
// rather than flattening it. Anything moved here is value-for-value identical to the inline copy it
// replaced, so the rendered PDFs stay byte-for-byte equivalent.

import { StyleSheet, Text, View } from "@react-pdf/renderer";

export const ACCENT = "#2563eb";
export const INK = "#0f172a";
export const MUTED = "#475569";
export const FAINT = "#94a3b8";
export const LINE = "#e2e8f0";

/** Four score bands shared by every report PDF: >=80 green, >=60 accent, >=40 amber, else red. */
export function scoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return ACCENT;
  if (score >= 40) return "#d97706";
  return "#dc2626";
}

/**
 * Style fragments shared across the docs that use each key:
 *  - page / kicker / sectionH / footer — all three documents (identical)
 *  - meta — all three (briefing + security `meta`; report's url line uses the same values)
 *  - h1 / rule — briefing + security (identical at 24 / marginVertical 14). report-document overrides
 *    both locally (22 / 16), so it keeps its own copies rather than these defaults.
 *  - statsRow / muted — briefing + security only (report has no equivalent)
 * Reference these directly (e.g. `baseStyles.page`); each document keeps its own local StyleSheet for
 * the keys that are document-specific or that legitimately differ.
 */
export const baseStyles = StyleSheet.create({
  page: { paddingVertical: 44, paddingHorizontal: 48, fontSize: 10, color: INK, fontFamily: "Helvetica", lineHeight: 1.45 },
  kicker: { fontSize: 9, letterSpacing: 3, color: ACCENT, fontFamily: "Helvetica-Bold", textTransform: "uppercase" },
  h1: { fontSize: 24, fontFamily: "Helvetica-Bold", marginTop: 6 },
  meta: { fontSize: 9, color: FAINT, marginTop: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: LINE, marginVertical: 14 },
  sectionH: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  statsRow: { flexDirection: "row", gap: 28 },
  muted: { color: MUTED },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: FAINT, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
});

const statStyles = StyleSheet.create({
  stat: { flexDirection: "column" },
  statLabel: { fontSize: 8, letterSpacing: 2, color: FAINT, textTransform: "uppercase" },
  statVal: { fontSize: 26, fontFamily: "Helvetica-Bold", marginTop: 2 },
  statSub: { fontSize: 8, color: MUTED, marginTop: 1 },
});

/** A labelled headline stat (used in the briefing + security stat rows). */
export function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <View style={statStyles.stat}>
      <Text style={statStyles.statLabel}>{label}</Text>
      <Text style={{ ...statStyles.statVal, color }}>{value}</Text>
      {sub ? <Text style={statStyles.statSub}>{sub}</Text> : null}
    </View>
  );
}

/** Fixed page footer: a per-document `note` on the left, `pageNumber / totalPages` on the right. */
export function Footer({ note }: { note: string }) {
  return (
    <View style={baseStyles.footer} fixed>
      <Text>{note}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}
