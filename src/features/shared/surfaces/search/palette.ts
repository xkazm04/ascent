// command-surface: the navigate intent. A subsequence matcher scored by the SHAPE of the match
// (boundary hits, consecutive runs, an early start, coverage) with a real rejection floor, a personal
// prior that breaks ties within the matched set and never overrides matching, and a final stable-id
// tiebreak so the blind-enter contract rests on nothing accidental. No React.

export type PaletteItem = { id: string; label: string; kind: "command" | "repository"; keywords?: string };

export const FLOOR = 12;

export type Match = { score: number; positions: number[] };

const isBoundary = (label: string, i: number): boolean => i === 0 || !/[\p{L}\p{N}]/u.test(label[i - 1]) || (/\p{Lu}/u.test(label[i]) && /\p{Ll}/u.test(label[i - 1]));

/** Every query character in order; scored so initials outrank an interior substring of the wrong item. */
export function fuzzy(query: string, label: string): Match | null {
  const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const l = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!q) return { score: 0, positions: [] };
  const positions: number[] = [];
  let score = 0;
  let at = 0;
  for (const ch of q) {
    // Prefer a boundary occurrence when one exists ahead; otherwise the nearest.
    let idx = l.indexOf(ch, at);
    if (idx < 0) return null;
    for (let j = idx; j >= 0 && j < l.length; j = l.indexOf(ch, j + 1)) {
      if (isBoundary(label, j)) {
        idx = j;
        break;
      }
    }
    const consecutive = positions.length > 0 && idx === positions[positions.length - 1] + 1;
    score += isBoundary(label, idx) ? 10 : 2;
    if (consecutive) score += 6;
    score -= Math.max(0, idx - at); // the gap penalty grows with distance
    positions.push(idx);
    at = idx + 1;
  }
  if (positions[0] === 0) score += 20; // exact prefix of a short label is the strongest match there is
  score += Math.round((20 * q.length) / l.length); // coverage
  return { score, positions };
}

export type Scored = { item: PaletteItem; match: Match };

/**
 * Order among candidates: text score, then the personal prior (most recent first), then stable id.
 * With an empty query the personal list leads — summon-enter with no typing is the "switch back" gesture.
 */
export function rankItems(items: readonly PaletteItem[], query: string, recent: readonly string[]): { shown: Scored[]; rejected: number } {
  const prior = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const byId = (a: PaletteItem, b: PaletteItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!query.trim()) {
    const shown = [...items].sort((a, b) => prior(a.id) - prior(b.id) || byId(a, b)).map((item) => ({ item, match: { score: 0, positions: [] } }));
    return { shown, rejected: 0 };
  }
  const scored: Scored[] = [];
  let rejected = 0;
  for (const item of items) {
    const m = fuzzy(query, item.label) ?? (item.keywords ? fuzzy(query, item.keywords) : null);
    if (!m || m.score < FLOOR) rejected += 1;
    else scored.push({ item, match: m });
  }
  scored.sort((a, b) => b.match.score - a.match.score || prior(a.item.id) - prior(b.item.id) || byId(a.item, b.item));
  return { shown: scored, rejected };
}

/** The session ledger: most-recent-first, keyed by stable identity, capped. */
export function remember(recent: readonly string[], id: string, cap = 5): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, cap);
}
