// kind-taxonomy: ONE closed vocabulary, ONE classifier, and every consumer of the scene — the row
// glyph, the filter chips, the sort-by-kind comparator, the preview dispatcher's rung ceiling, the
// per-kind counts — derives from this file. Adding a kind is one edit here; nothing else in the
// folder knows an extension. Tokens are identifiers with compatibility obligations (the persisted
// nav blob stores them), so `label` is looked up from the token and never stored. No React.

/** Declared order — a deliberate ranking (containers first, then by expected frequency), not the
 *  alphabetical accident of the token spelling. `sort by kind` reads this. */
export const KIND_ORDER = ["folder", "document", "image", "data", "audio", "other"] as const;
export type Kind = (typeof KIND_ORDER)[number];

/** The preview ladder: 1 = kind icon (the floor every item stands on), 2 = thumbnail, 3 = inline preview. */
export type Rung = 1 | 2 | 3;

export type KindSpec = {
  label: string;
  glyph: string;
  /** The highest rung this kind can climb; an item renders the highest rung it has READY, never above this. */
  maxRung: Rung;
  /** Extension tokens — the cheapest reliable signal, wrong in known ways (renamed files, no extension). */
  ext: readonly string[];
  container?: boolean;
};

export const KINDS: Record<Kind, KindSpec> = {
  folder: { label: "Folder", glyph: "▸", maxRung: 1, ext: [], container: true },
  document: { label: "Document", glyph: "¶", maxRung: 3, ext: ["md", "txt"] },
  image: { label: "Image", glyph: "▦", maxRung: 3, ext: ["png", "svg", "jpg"] },
  data: { label: "Data", glyph: "{}", maxRung: 3, ext: ["json", "yaml"] },
  audio: { label: "Audio", glyph: "♪", maxRung: 1, ext: ["wav"] },
  other: { label: "Other", glyph: "·", maxRung: 1, ext: [] },
};

/** The one classifier. Signal: the extension token; `other` is a real bucket, not a failure. */
export function classify(name: string, isDir: boolean): Kind {
  if (isDir) return "folder";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  for (const k of KIND_ORDER) if (KINDS[k].ext.includes(ext)) return k;
  return "other";
}

export const kindRank = (k: Kind): number => KIND_ORDER.indexOf(k);
export const LEAF_KINDS = KIND_ORDER.filter((k) => !KINDS[k].container);
