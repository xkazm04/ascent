"use client";

// vocabulary-chain-integrity: the four layers of one vocabulary, each shown as a DERIVATION of the
// union in vocabulary.ts (constraint mirrored from the gated map's keys; catalog under a Covers<>
// gate; presentation keyed by the union), plus the two paths a chain must survive in production —
// a skewed producer delivering a member this consumer has no label for (resolved totally, and the
// miss REPORTED) and an order held as a total map rather than an array.
// status-color-mapping: the presentation tables as legends — role, glyph and label in one entry —
// with each vocabulary's unknown direction written beside its fallback, and a "drop colour" toggle
// proving shape carries the distinction on its own.

import { useEffect, useReducer } from "react";
import { HOSTILE_SAMPLES, SKEW_ROW } from "./fixtures";
import { useSceneLocale } from "./locale";
import { SeverityPill, StatusPill } from "./primitives";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import {
  CATALOG, ROLE_SLOTS, SCAN_STATUS_MEMBERS, SCAN_STATUS_PRESENTATION, SCAN_STATUS_RANK, SCAN_STATUS_UNKNOWN, SEVERITY_MEMBERS,
  SEVERITY_PRESENTATION, SEVERITY_UNKNOWN, STORAGE_CHECK, UNKNOWN_RANK, listMisses, onMiss, type Presentation,
} from "./vocabulary";

const LAYERS: readonly { layer: string; owner: string; artifact: string }[] = [
  { layer: "1 · storage constraint", owner: "mirrored from the gated map's keys", artifact: STORAGE_CHECK },
  { layer: "2 · wire token", owner: "the authority — a closed type", artifact: `type ScanStatus = ${SCAN_STATUS_MEMBERS.map((m) => `"${m}"`).join(" | ")}` },
  { layer: "3 · label catalog", owner: "Record<Locale, Record<LabelKey, string>> + Covers<>", artifact: `"status.warned" → "${CATALOG["en-US"]["status.warned"]}" · "${CATALOG["de-DE"]["status.warned"]}" · "${CATALOG["hi-IN"]["status.warned"]}"` },
  { layer: "4 · presentation", owner: "Record<ScanStatus, { role, glyph, labelKey }>", artifact: `warned → { role: "${SCAN_STATUS_PRESENTATION.warned.role}", glyph: "${SCAN_STATUS_PRESENTATION.warned.glyph}" }` },
];

export function ChainRegion({ skew, onSkew, worstFirst, onWorstFirst }: { skew: boolean; onSkew: (v: boolean) => void; worstFirst: boolean; onWorstFirst: (v: boolean) => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onMiss(rerender), []);
  const misses = listMisses();
  return (
    <Region technique="vocabulary-chain-integrity" title="One authority, three derivations" note="Every layer below derives from the union; the drift gates are type annotations that fail by member name. Then break the chain from outside.">
      <ul className="space-y-1">
        {LAYERS.map((l) => (
          <li key={l.layer} className="grid gap-x-3 rounded-md border border-divider px-2 py-1 sm:grid-cols-[11rem_1fr]">
            <span className="type-caption text-slate-200">
              {l.layer}
              <span className="block text-slate-600">{l.owner}</span>
            </span>
            <code className="truncate type-caption text-slate-400" title={l.artifact}>{l.artifact}</code>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={skew ? BTN_ON : BTN} onClick={() => onSkew(!skew)} aria-pressed={skew}>
          {skew ? "withdraw the skewed producer" : `deliver "${SKEW_ROW.status}" from a newer producer`}
        </button>
        <button type="button" className={worstFirst ? BTN_ON : BTN} onClick={() => onWorstFirst(!worstFirst)} aria-pressed={worstFirst}>
          sort worst-first
        </button>
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="misses reported" value={<span data-misses={misses.length}>{misses.length === 0 ? "none" : misses.map((m) => `${m.category}/${m.token}`).join(" · ")}</span>} tone={misses.length ? "text-warn" : "text-slate-200"} />
        <Readout label="rank map" value={`${SCAN_STATUS_MEMBERS.map((m) => `${m}:${SCAN_STATUS_RANK[m]}`).join(" ")} · unknown:${UNKNOWN_RANK} (decided)`} />
      </div>
      <p className="mt-2 type-caption text-slate-500">
        The resolver is total: the ledger never crashes and never shows a raw token; the miss lands in the ledger above with the category and token, in production. The unknown member sorts to the attention end by decision, not because <code>indexOf</code> returned −1.
      </p>
    </Region>
  );
}

function LegendRow({ token, p, note }: { token: string; p: Presentation; note?: string }) {
  const locale = useSceneLocale();
  const s = ROLE_SLOTS[p.role];
  return (
    <li className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 type-caption" data-legend={token}>
      <code className="text-slate-500">{token}</code>
      <span className="text-slate-400">
        {p.role} <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} aria-hidden /> {note ?? CATALOG[locale][p.labelKey]}
      </span>
      <span className={`${s.text} tabular-nums`} aria-hidden>{p.glyph}</span>
    </li>
  );
}

export function ColorRegion({ noColor, onNoColor }: { noColor: boolean; onNoColor: (v: boolean) => void }) {
  return (
    <Region technique="status-color-mapping" title="Vocabulary → role → themed value" note="One entry carries role, glyph and label key. The fallback has a direction, chosen per vocabulary and written down.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 type-caption text-slate-200">scan status · a STATE set</p>
          <ul className="space-y-1">
            {SCAN_STATUS_MEMBERS.map((m) => <LegendRow key={m} token={m} p={SCAN_STATUS_PRESENTATION[m]} />)}
            <LegendRow token="(unknown)" p={SCAN_STATUS_UNKNOWN} note="neutral — the system has not learned the word" />
          </ul>
        </div>
        <div>
          <p className="mb-1 type-caption text-slate-200">finding severity · a SEVERITY set</p>
          <ul className="space-y-1">
            {SEVERITY_MEMBERS.map((m) => <LegendRow key={m} token={m} p={SEVERITY_PRESENTATION[m]} />)}
            <LegendRow token="(unknown)" p={SEVERITY_UNKNOWN} note="most severe — never calm while a human is owed a decision" />
          </ul>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={noColor ? BTN_ON : BTN} onClick={() => onNoColor(!noColor)} aria-pressed={noColor}>
          drop colour from the ledger
        </button>
        <span className="type-caption text-slate-500">{noColor ? "grey ledger: the glyph and the label still tell the rows apart" : "shape rides in the same entry as the role, so colour is never the only channel"}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Sample pills">
        <StatusPill token="warned" />
        <SeverityPill token="critical" />
        <span className="type-caption text-slate-600">← the pill takes the token and owns the table; a name that looks like one ({HOSTILE_SAMPLES[3].value}) never reaches it</span>
      </div>
    </Region>
  );
}
