// The words in the sky. At-work bodies get the BIG label — repo, phase in words, the file it touched
// last, and one small line (time in phase, the worktree diff) — in type that reads from three metres
// and scales with the screen (it is SVG text in viewBox units). Everyone else gets a small name and
// the reason they are where they are. No hooks — no "use client".
//
// A changed phase word or file re-enters with a short fade (`starting:` + a key on the value), which
// is the label's only motion and is tied to the change itself. Reduced motion: none.

import type { SkyBody, SkyModel } from "./skyModel";
import type { Pt, SkyFrame } from "./skyEllipse";
import { PRIMARY, fitPath, primaryLines, type PlacedLabel } from "./skyLayout";
import { INK_HALO, NOTE_FILL, TONE_TEXT } from "./skyPalette";

const FADE = "transition-opacity duration-500 ease-out starting:opacity-0";

function PrimaryLabel({ body, label, reduced }: { body: SkyBody; label: PlacedLabel; reduced: boolean }) {
  const { box, anchor, lead } = label;
  const x = anchor === "start" ? box.x : box.x + box.w;
  const small = primaryLines(body).small;
  const fade = reduced ? "" : FADE;
  // Lines stack with no hole where one is absent (a planning lane has touched no file yet).
  const at: Record<"name" | "phase" | "file" | "small", number> = { name: 0, phase: 0, file: 0, small: 0 };
  let cursor = box.y + PRIMARY.baselines[0];
  at.name = cursor;
  if (body.phase) at.phase = cursor += PRIMARY.baselines[1] - PRIMARY.baselines[0];
  if (body.file) at.file = cursor += PRIMARY.baselines[2] - PRIMARY.baselines[1];
  if (small) at.small = cursor += PRIMARY.baselines[3] - PRIMARY.baselines[2];
  const y = (k: keyof typeof at) => at[k];
  return (
    <g data-label={body.repo} data-label-size="big">
      {lead ? (
        <line x1={lead.x} y1={lead.y} x2={anchor === "start" ? x - 12 : x + 12} y2={box.y + PRIMARY.h / 2 - 8} className="stroke-slate-600" strokeWidth={1} />
      ) : null}
      <text x={x} y={y("name")} textAnchor={anchor} className="type-display-lg font-semibold fill-white" style={INK_HALO}>
        {body.name}
      </text>
      {body.phase ? (
        <text key={body.phase} x={x} y={y("phase")} textAnchor={anchor} className={`type-display font-medium ${TONE_TEXT[body.tone]} ${fade}`} style={INK_HALO}>
          {body.phase}
        </text>
      ) : null}
      {body.file ? (
        <text
          key={body.file}
          x={x}
          y={y("file")}
          textAnchor={anchor}
          className={`font-mono type-heading ${body.fileEdited ? "fill-amber-300" : "fill-accent-soft"} ${fade}`}
          style={INK_HALO}
        >
          {fitPath(body.file)}
        </text>
      ) : null}
      {small ? (
        <text x={x} y={y("small")} textAnchor={anchor} className="font-mono type-mono-sm tabular-nums fill-slate-400" style={INK_HALO}>
          {small}
        </text>
      ) : null}
    </g>
  );
}

function SmallLabel({ body, label, emphasis }: { body: SkyBody; label: PlacedLabel; emphasis: boolean }) {
  const { box, anchor } = label;
  const x = anchor === "start" ? box.x : anchor === "end" ? box.x + box.w : box.x + box.w / 2;
  const big = body.ring === 1;
  const nameY = box.y + (big ? 21 : 18);
  return (
    <g data-label={body.repo} data-label-size="small" opacity={body.ring === 2 && !emphasis ? 0.8 : 1}>
      <text x={x} y={nameY} textAnchor={anchor} className={`${big ? "type-heading" : "type-title"} font-medium ${big ? "fill-slate-100" : "fill-slate-300"}`} style={INK_HALO}>
        {body.name}
      </text>
      {!label.nameOnly && body.note ? (
        <text
          x={x}
          y={nameY + (big ? 24 : 21)}
          textAnchor={anchor}
          className={`${big ? "type-body" : "type-body-sm"} ${emphasis ? "fill-slate-100" : NOTE_FILL[body.noteTone]}`}
          style={INK_HALO}
        >
          {body.note}
        </text>
      ) : null}
    </g>
  );
}

export function SkyLabels({ model, labels, reduced }: { model: SkyModel; labels: readonly PlacedLabel[]; reduced: boolean }) {
  const byRepo = new Map(model.bodies.map((b) => [b.repo, b]));
  return (
    <g pointerEvents="none">
      {labels.map((l) => {
        const b = byRepo.get(l.repo);
        if (!b) return null;
        if (b.ring === 0) return <PrimaryLabel key={l.repo} body={b} label={l} reduced={reduced} />;
        return <SmallLabel key={l.repo} body={b} label={l} emphasis={model.nextWake?.repo === b.repo} />;
      })}
    </g>
  );
}

export function CoreLabel({ f, core, at }: { f: SkyFrame; core: SkyModel["core"]; at: Pt }) {
  if (!core.title && !core.sub) return null;
  const tone = core.tone === "hold" ? "fill-amber-300" : core.tone === "live" ? "fill-slate-200" : "fill-slate-300";
  const top = at.y + 22;
  return (
    <g pointerEvents="none" data-core-label>
      {core.title ? (
        <text x={f.cx} y={top + 22} textAnchor="middle" className={`type-heading font-semibold ${tone}`} style={INK_HALO}>
          {core.title}
        </text>
      ) : null}
      {core.sub ? (
        <text x={f.cx} y={top + (core.title ? 48 : 16)} textAnchor="middle" className="font-mono type-mono-sm tabular-nums fill-slate-400" style={INK_HALO}>
          {core.sub}
        </text>
      ) : null}
    </g>
  );
}
