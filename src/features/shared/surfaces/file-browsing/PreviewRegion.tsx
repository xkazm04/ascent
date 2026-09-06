"use client";

// thumbnails-and-previews: the escalation ladder (kind icon → thumbnail → inline preview) per item,
// decode work only for images in the mounted window (never the folder), a cache keyed on identity +
// content version with an LRU reaper and cached failures, and a per-tile boundary: a corrupt image
// costs one tile — the kind icon stays, the row stays selectable, renamable, trashable.

import { useMemo, useState } from "react";
import type { Entry } from "./fixtures";
import { KINDS } from "./kinds";
import { PreviewCache, excerptFor, rungFor, thumbKey, type Thumb } from "./previewCache";
import { BTN, KindGlyph, Readout, Region } from "./sceneParts";
import type { Vault } from "./useVault";

const TILES = 8;

function Bars({ thumb, size }: { thumb: Thumb; size: number }) {
  if (thumb.state === "failed") return null;
  return (
    <svg viewBox="0 0 50 30" width={size} height={size * 0.6} className="text-accent" aria-hidden>
      {thumb.bars.map((h, i) => (
        <rect key={i} x={i * 10 + 1} y={30 - h * 30} width={8} height={h * 30} fill="currentColor" opacity={0.35 + i * 0.13} />
      ))}
    </svg>
  );
}

export function PreviewRegion({ vault }: { vault: Vault }) {
  // One cache for the region's life; `get` is deterministic per key, so memoizing over the window is
  // the "generate near the viewport" rule — entries outside the mounted window never decode.
  const [cache] = useState(() => new PreviewCache());
  const images = useMemo(() => vault.visible.filter((e) => e.kind === "image").slice(0, TILES), [vault.visible]);
  const { thumbs, stats } = useMemo(() => {
    const thumbs = new Map<string, Thumb>();
    for (const e of images) thumbs.set(e.id, cache.get(e));
    if (vault.focused?.kind === "image") thumbs.set(vault.focused.id, cache.get(vault.focused));
    return { thumbs, stats: cache.snapshot() };
  }, [cache, images, vault.focused]);
  const f: Entry | null = vault.focused;
  const rung = f ? rungFor(f, thumbs.get(f.id) ?? null) : null;
  const thumb = f ? thumbs.get(f.id) : undefined;
  return (
    <Region technique="thumbnails-and-previews" title="Previews are guests" note="Icon → thumbnail → inline preview: the highest rung READY, never a hole. Keyed on id@version; failures cached; budget with an LRU reaper.">
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8" aria-label="Thumbnails for the window's images">
        {images.map((e) => {
          const t = thumbs.get(e.id)!;
          return (
            <li key={e.id} className="flex flex-col items-center gap-0.5 rounded-md border border-divider p-1" data-thumb={t.state} title={e.name}>
              {t.state === "ok" ? <Bars thumb={t} size={40} /> : <span className="flex h-6 items-center type-mono-sm text-slate-500">{KINDS.image.glyph}</span>}
              <span className="type-micro text-slate-600">{t.state === "ok" ? `v${e.version}` : "unavailable"}</span>
            </li>
          );
        })}
        {images.length === 0 ? <li className="col-span-full type-caption text-slate-500">No images in the window — nothing decodes.</li> : null}
      </ul>
      <div className="mt-3 rounded-md border border-divider p-2" data-rung={rung ?? "none"}>
        {f ? (
          <>
            <div className="flex items-center gap-2">
              <KindGlyph kind={f.kind} />
              <span className="min-w-0 flex-1 truncate type-caption text-slate-200">{f.name}</span>
              <span className="type-micro text-slate-500">rung {rung} of {KINDS[f.kind].maxRung}</span>
            </div>
            <div className="mt-2 min-h-[2.5rem]">
              {f.kind === "image" && thumb?.state === "ok" ? <Bars thumb={thumb} size={120} /> : null}
              {f.kind === "image" && thumb?.state === "failed" ? <p className="type-caption text-warn">Could not preview this file ({thumb.reason}). It is still selectable, renamable and trashable.</p> : null}
              {f.kind === "document" || f.kind === "data" ? <pre className="whitespace-pre-wrap type-micro text-slate-400">{excerptFor(f)}</pre> : null}
              {rung === 1 && f.kind !== "image" ? <p className="type-caption text-slate-500">Kind icon is the floor for {KINDS[f.kind].label.toLowerCase()}; no higher rung exists.</p> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!f.isDir ? (
                <button type="button" className={BTN} onClick={() => vault.touchFile(f.id)} aria-label="Rewrite the focused file's bytes">
                  rewrite bytes → v{f.version + 1}
                </button>
              ) : null}
              <span className="type-micro text-slate-500">cache key {f.isDir ? "—" : thumbKey(f)}</span>
            </div>
          </>
        ) : (
          <p className="type-caption text-slate-500">Focus a row to open its preview. A preview of a file that vanishes closes with a reason on the next refresh.</p>
        )}
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <Readout label="hits / misses" value={<span data-cache-hits={stats.hits}>{`${stats.hits} / ${stats.misses}`}</span>} />
        <Readout label="failures cached" value={<span data-cache-failures={stats.failures}>{stats.failures}</span>} tone={stats.failures > 0 ? "text-warn" : "text-slate-200"} />
        <Readout label="resident / budget" value={`${stats.size} / ${cache.budget}`} />
        <Readout label="evicted (reaper)" value={stats.evictions} />
      </div>
    </Region>
  );
}
