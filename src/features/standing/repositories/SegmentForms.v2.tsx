"use client";

// Create, rename, and auto-tag controls for the Prism segment manager. Same handlers as the v1 rows.
import { useId } from "react";
import { FormField, GhostAction, Input, PrimaryAction, Select } from "@/components/kit";
import type { SegmentItem } from "./RepoSegmentsPanel";
import { SegmentSwatchesV2 } from "./SegmentSwatches.v2";

const NAME_MAX = 60;

export function SegmentEditorV2({
  editingId,
  editName,
  setEditName,
  editColor,
  setEditColor,
  saveEdit,
  setEditingId,
}: {
  editingId: string;
  editName: string;
  setEditName: (v: string) => void;
  editColor: string;
  setEditColor: (v: string) => void;
  saveEdit: (id: string) => void;
  setEditingId: (v: string | null) => void;
}) {
  const nameId = useId();
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <FormField label="Segment name" htmlFor={nameId} className="min-w-48 flex-1">
        <Input
          id={nameId}
          value={editName}
          aria-label="Segment name"
          maxLength={NAME_MAX}
          autoFocus
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit(editingId);
            if (e.key === "Escape") setEditingId(null);
          }}
        />
      </FormField>
      <SegmentSwatchesV2 value={editColor} onPick={setEditColor} label="Recolor" />
      <PrimaryAction onClick={() => saveEdit(editingId)}>Save</PrimaryAction>
      <GhostAction onClick={() => setEditingId(null)}>Cancel</GhostAction>
    </div>
  );
}

export function AutoAddRowV2({
  languages,
  teams,
  segments,
  autoMode,
  setAutoMode,
  autoLang,
  setAutoLang,
  autoSeg,
  setAutoSeg,
  autoBusy,
  autoAdd,
}: {
  languages: [string, number][];
  teams: [string, number][];
  segments: SegmentItem[];
  autoMode: "language" | "team";
  setAutoMode: (v: "language" | "team") => void;
  autoLang: string;
  setAutoLang: (v: string) => void;
  autoSeg: string;
  setAutoSeg: (v: string) => void;
  autoBusy: boolean;
  autoAdd: () => void;
}) {
  const modeId = useId();
  const matchId = useId();
  const segId = useId();
  const options = autoMode === "team" ? teams : languages;
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      {teams.length > 0 && (
        <FormField label="Match by" htmlFor={modeId} className="min-w-36">
          <Select
            id={modeId}
            value={autoMode}
            aria-label="Auto-add mode"
            onChange={(e) => {
              setAutoMode(e.target.value as "language" | "team");
              setAutoLang("");
            }}
          >
            <option value="language">Language</option>
            <option value="team">Team</option>
          </Select>
        </FormField>
      )}
      <FormField
        label={autoMode === "team" ? "Team" : "Language"}
        htmlFor={matchId}
        className="min-w-40"
        hint={teams.length === 0 ? "Team options appear after a scan reads CODEOWNERS." : undefined}
      >
        <Select
          id={matchId}
          value={autoLang}
          aria-label={autoMode === "team" ? "Auto-add team" : "Auto-add language"}
          onChange={(e) => setAutoLang(e.target.value)}
        >
          <option value="">{autoMode === "team" ? "team…" : "language…"}</option>
          {options.map(([lang, n]) => (
            <option key={lang} value={lang}>
              {lang} ({n})
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Segment" htmlFor={segId} className="min-w-40">
        <Select id={segId} value={autoSeg} aria-label="Auto-add target segment" onChange={(e) => setAutoSeg(e.target.value)}>
          <option value="">segment…</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </FormField>
      <PrimaryAction onClick={autoAdd} disabled={autoBusy || !autoLang || !autoSeg}>
        {autoBusy ? "Adding…" : "Add all"}
      </PrimaryAction>
    </div>
  );
}

export function CreateSegmentRowV2({
  color,
  setColor,
  name,
  setName,
  createSegment,
  busy,
}: {
  color: string;
  setColor: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  createSegment: () => void;
  busy: boolean;
}) {
  const nameId = useId();
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-divider pt-4">
      <SegmentSwatchesV2 value={color} onPick={setColor} label="Color" />
      <FormField label="New segment" htmlFor={nameId} className="min-w-48 flex-1">
        <Input
          id={nameId}
          value={name}
          maxLength={NAME_MAX}
          placeholder="New segment name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createSegment()}
        />
      </FormField>
      <PrimaryAction onClick={createSegment} disabled={busy || !name.trim()}>
        {busy ? "Adding…" : "Add segment"}
      </PrimaryAction>
    </div>
  );
}
