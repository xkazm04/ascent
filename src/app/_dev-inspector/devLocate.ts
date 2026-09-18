/**
 * Pure helpers for the DevInspector — kept separate from the component so the
 * DOM-walking / path-classification logic stays small and easy to reason about.
 * Only meaningful in `npm run dev:inspect`, where the `inject-source-loc` Babel
 * pass stamps host elements with `data-loc="<path>:LINE:COL"`.
 */

export interface LocEntry {
  /** The DOM element carrying this `data-loc`. */
  el: Element;
  /** Copied reference (Claude-Code clickable): `src/.../File.tsx:88`. */
  loc: string;
  /** Repo-relative path: `src/.../File.tsx`. */
  path: string;
  /** 1-based line. */
  line: number;
}

/**
 * Clipboard formats the HUD can copy. `claude` (`path:line`) is the default —
 * right-click, Alt+right-click, and crumb-row click all use it. `vscode` is a
 * HUD-only action (`code -g path:line`) so Alt+right-click stays "innermost
 * element", not a format switch.
 */
export const HUD_COPY_FORMATS = ["claude", "vscode"] as const;
export type HudCopyFormat = (typeof HUD_COPY_FORMATS)[number];

/** Claude-Code `path:line`, or VS Code / Cursor `code -g ${path}:${line}`. */
export function formatHudCopy(loc: string, format: HudCopyFormat = "claude"): string {
  return format === "vscode" ? `code -g ${loc}` : loc;
}

/** Split `src/a/b/File.tsx:88` → `{ dir: 'src/a/b/', file: 'File.tsx:88' }`. */
export function splitLoc(loc: string): { dir: string; file: string } {
  const slash = loc.lastIndexOf("/");
  return slash === -1
    ? { dir: "", file: loc }
    : { dir: loc.slice(0, slash + 1), file: loc.slice(slash + 1) };
}

/**
 * Repo-relative path PREFIXES of the shared "library" roots. When resolving the
 * default copy target we skip files under these and land on the call site (the
 * feature/page file that *used* the shared component). Alt+right-click still
 * reaches them.
 *
 * ANCHORED prefix match, deliberately not an any-segment substring test: a
 * feature-LOCAL `hooks/` / `utils/` / `ui/` folder (e.g.
 * `src/components/landing/hooks/…`) is that feature's own code, and the old
 * substring heuristic classified it as library — silently redirecting the
 * default right-click copy to a parent file with no HUD signal. This list is a
 * positive allowlist of the repo's shared roots and MUST track repo layout
 * when shared code moves (it is a snapshot, not a convention detector). Exported so the guard in
 * devLocate.test.ts can check each entry against the filesystem rather than re-typing the list —
 * a moved shared root would otherwise silently stop being skipped, with every assertion still green.
 */
export const LIBRARY_ROOTS = [
  "src/lib/",
  "src/components/ui/",
  "src/components/org/shared/",
  "src/app/_dev-inspector/",
];

export function isLibraryPath(path: string): boolean {
  const p = path.replace(/^\.?\//, ""); // tolerate "./src/…" / "/src/…" stamps
  return LIBRARY_ROOTS.some((root) => p.startsWith(root));
}

export function parseLoc(raw: string): Omit<LocEntry, "el"> | null {
  const m = /^(.*):(\d+):(\d+)$/.exec(raw);
  if (!m) return null;
  const [, path, lineStr] = m;
  if (!path || !lineStr) return null;
  return { path, line: Number(lineStr), loc: `${path}:${lineStr}` };
}

/** DOM ancestor chain of `[data-loc]` elements, innermost → outermost. */
export function buildChain(start: Element | null): LocEntry[] {
  const out: LocEntry[] = [];
  let el: Element | null = start?.closest("[data-loc]") ?? null;
  while (el) {
    const raw = el.getAttribute("data-loc");
    const parsed = raw ? parseLoc(raw) : null;
    if (parsed) out.push({ el, ...parsed });
    el = el.parentElement?.closest("[data-loc]") ?? null;
  }
  return out;
}

/**
 * Index of the default copy target: the first non-library file in the chain
 * (the call site), falling back to the innermost element when everything in
 * the chain is library code.
 */
export function pickDefaultIndex(chain: LocEntry[]): number {
  const i = chain.findIndex((c) => !isLibraryPath(c.path));
  return i === -1 ? 0 : i;
}

/** Collapse consecutive entries that resolve to the same `path:line`. */
export function dedupeChain(chain: LocEntry[]): LocEntry[] {
  return chain.filter((c, i) => i === 0 || c.loc !== chain[i - 1]?.loc);
}

/** HUD index of the default copy target in a (usually deduped) crumb list. */
export function defaultCrumbIndex(crumbs: readonly { loc: string }[], defaultLoc: string | null): number {
  if (!defaultLoc || crumbs.length === 0) return 0;
  const i = crumbs.findIndex((c) => c.loc === defaultLoc);
  return i === -1 ? 0 : i;
}

/** Wrap HUD crumb selection so ↑ on the first row lands on the last. */
export function stepCrumbIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  const cur = ((current % length) + length) % length;
  return (cur + (delta % length) + length) % length;
}

/**
 * Horizontal placement of the `File.tsx:LINE` chip, clamped to stay on screen.
 *
 * The clamp must use the chip's OWN width, not the maximum a chip may reach: clamping every chip
 * against the 260px ceiling yanked a short label (`Hero.tsx:9`, ~60px) 200px left of the element it
 * labels whenever that element sat near the right edge — the chip then points at the wrong region,
 * which is the one thing it exists not to do. Width is estimated from the text because the chip is
 * rendered in a fixed 11px monospace face (~0.6em advance) with 6px of padding a side; the estimate
 * only has to be good enough to keep the chip on screen, and `maxWidth` + ellipsis still enforce the
 * ceiling. `pad` is the viewport margin the caller keeps on the right.
 */
export function chipLeft(
  rectLeft: number,
  label: string,
  viewportWidth: number,
  opts: { maxWidth: number; charPx?: number; padPx?: number } = { maxWidth: 260 },
): number {
  const width = Math.min(opts.maxWidth, Math.ceil(label.length * (opts.charPx ?? 6.6)) + (opts.padPx ?? 12));
  return Math.max(4, Math.min(rectLeft, viewportWidth - width));
}
