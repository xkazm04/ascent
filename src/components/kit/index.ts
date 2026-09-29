// The composition kit — the shared building blocks one level above buttons. Import from "@/components/kit".
// Styling: data-kit hooks in src/app/kit.css (Altimeter base + Prism expression).
export { Panel } from "./Panel";
export type { PanelPad } from "./Panel";
export { Section } from "./Section";
export { StatStrip, StatTile } from "./StatTile";
export { KeyValue } from "./KeyValue";
export type { KeyValueItem } from "./KeyValue";
export { ListRows, ListRow, RowList } from "./ListRow";
export { ChipRow, Chip } from "./ChipRow";
export type { ChipTone } from "./ChipRow";
export { Toolbar, ToolbarReadout } from "./Toolbar";
export { Segmented } from "./Segmented";
export type { SegmentedOption } from "./Segmented";
export { SettingRow } from "./SettingRow";
export { DataTable, CELL, CELL_NUM, HEAD_CELL } from "./DataTable";

// v2 language (docs/design/KIT-V2-LANGUAGE.md): type roles, structure, identity marks.
export { Display, Eyebrow, Lede, Caption, MonoPath } from "./Type";
export type { DisplayLevel } from "./Type";
export { Frame } from "./Frame";
export type { FrameEdge } from "./Frame";
export { SectionHead } from "./SectionHead";
export { LevelNav } from "./LevelNav";
export type { Crumb, LevelLink } from "./LevelNav";
export { EscBack } from "./LevelNav.client";
export { DimensionLine } from "./DimensionLine";
export type { DimensionId } from "./DimensionLine";
export { EvidencePanel } from "./EvidencePanel";
export type { EvidenceFact } from "./EvidencePanel";
export { Plate } from "./Plate";
export { SpectralRule, HonestyTag } from "./Marks";
export type { HonestyKind } from "./Marks";
export { PrimaryAction, GhostAction } from "./Actions";
export { Masthead } from "./Masthead";
export type { MastheadFigure } from "./Masthead";
export { useHashFlag } from "./useHashFlag";
export { DimensionMark, parseDimension } from "./DimensionMark";
