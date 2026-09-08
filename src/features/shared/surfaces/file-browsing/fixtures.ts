// Deterministic fixtures for the vault browser: a seeded (mulberry32) hierarchical store shaped like
// a knowledge registry — `knowledge/`, `skills/`, `practices/`, `memory/`, `assets/` — sized by the
// volume knob (`volume` leaves, most of them in `assets/`, so one directory is the big one). Every
// entry is minted an identity ONCE (`f-<n>`) and carries it through renames, moves and restarts;
// nothing in the scene keys on a position. FICTION: the scene says so on screen. No React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { classify, type Kind } from "./kinds";

export type Entry = {
  id: string;
  parentId: string;
  name: string;
  kind: Kind;
  isDir: boolean;
  size: number;
  /** Content version — bumps when the bytes change; the thumbnail cache keys on id + version. */
  version: number;
  /** false = the store refuses to read this entry (permission); the listing skips-and-counts it. */
  readable: boolean;
  /** An image whose bytes do not decode: the thumbnail fails, one tile, never the grid. */
  corrupt: boolean;
  /** Set while in the trash: where it came from, and when (store tick) it was trashed. */
  origin?: string;
  trashedAt?: number;
};

export const ROOT = "root";
export const TRASH = "trash";
/** The listing window: rows mounted from a complete in-memory listing (50,000 rows, 40 nodes). */
export const WINDOW = 40;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor", "isobar", "juniper", "kestrel", "lumen", "moraine", "nimbus"];
const EXTS = ["md", "md", "png", "json", "yaml", "svg", "wav", "md", "png", "bin", "txt", "jpg"];

/** Top-level directories. `scratch/` is empty and `system/` is unreadable — the two zero cases. */
const DIRS: readonly { id: string; name: string; readable: boolean; parent?: string }[] = [
  { id: "d-knowledge", name: "knowledge", readable: true },
  { id: "d-skills", name: "skills", readable: true },
  { id: "d-practices", name: "practices", readable: true },
  { id: "d-memory", name: "memory", readable: true },
  { id: "d-assets", name: "assets", readable: true },
  { id: "d-renders", name: "renders", readable: true, parent: "d-assets" },
  { id: "d-scratch", name: "scratch", readable: true },
  { id: "d-system", name: "system", readable: false },
];

/** How many leaves each small directory takes before the remainder lands in `assets/`. */
const SMALL: readonly [string, number][] = [
  ["d-knowledge", 8],
  ["d-skills", 6],
  ["d-practices", 6],
  ["d-memory", 6],
  ["d-renders", 4],
];

function dirEntry(id: string, parentId: string, name: string, readable: boolean): Entry {
  return { id, parentId, name, kind: "folder", isDir: true, size: 0, version: 1, readable, corrupt: false };
}

/** The whole store for one volume: root + directories + `volume` leaves, identities minted once. */
export function makeEntries(volume: SurfaceVolume): Map<string, Entry> {
  const rnd = mulberry32(volume);
  const entries = new Map<string, Entry>();
  entries.set(ROOT, dirEntry(ROOT, "", "vault", true));
  entries.set(TRASH, dirEntry(TRASH, "", "trash", true));
  for (const d of DIRS) entries.set(d.id, dirEntry(d.id, d.parent ?? ROOT, d.name, d.readable));

  const parentFor = (i: number): string => {
    let cursor = 0;
    for (const [dir, n] of SMALL) {
      cursor += n;
      if (i < cursor) return dir;
    }
    return "d-assets";
  };

  let images = 0;
  for (let i = 0; i < volume; i++) {
    const parentId = parentFor(i);
    const inAssets = parentId === "d-assets";
    const word = WORDS[Math.floor(rnd() * WORDS.length)];
    const ext = EXTS[Math.floor(rnd() * EXTS.length)];
    // Every 25th asset is a bookkeeping file the listing policy excludes (names starting with ".").
    const hidden = inAssets && i % 25 === 0;
    const name = hidden ? `.cache-${i}` : `${word}-${String(i + 1).padStart(2, "0")}.${ext}`;
    const kind = classify(name, false);
    if (kind === "image") images += 1;
    entries.set(`f-${i}`, {
      id: `f-${i}`,
      parentId,
      name,
      kind,
      isDir: false,
      size: Math.round(rnd() * 900_000 + 1_000),
      version: 1,
      // Every 13th asset and the third knowledge file are unreadable: skip-and-count, never abort.
      readable: !((inAssets && i % 13 === 0) || i === 2),
      // Every 4th image has bytes that do not decode: the thumbnail fails and the failure is cached.
      corrupt: kind === "image" && images % 4 === 0,
    });
  }
  return entries;
}

export const fmtBytes = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1_000 ? `${Math.round(n / 1_000)} KB` : `${n} B`);
