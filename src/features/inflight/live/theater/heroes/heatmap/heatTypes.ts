// The heat map's ACCUMULATOR shapes — what this screen has seen of each repo since it opened.
//
// The pulse is a bounded window (8 read paths, 8 edited paths, the 6 newest events), so the whole
// picture of a session only exists if the screen keeps it: every path any pulse named, with the time
// of its newest touch when a pulse said WHEN (a tail event's `at`), and `null` when it did not (a path
// that was already in the window the first time this screen saw the session — touched at some moment
// before, nobody said when). Times are epoch ms. Nothing here is persisted; a reload starts empty and
// the screen says "since HH:MM".

export type TouchKind = "read" | "edit";

export interface FileHeat {
  path: string;
  module: string;
  /** When this screen first saw the path (the fold's `now`) — the map's stable ordering key. */
  seenAt: number;
  /** Newest read/search, or null when the only evidence carried no time. */
  readAt: number | null;
  /** Newest edit/write, or null when the only evidence carried no time. */
  editAt: number | null;
  read: boolean;
  edited: boolean;
}

/** One lane session on a repo: `laneId` + `startedAt` (a lane row reused across cycles still resets). */
export interface HeatSession {
  key: string;
  startMs: number | null;
  /** Modules this session edited — what a landing stamps. */
  editedModules: string[];
  /** Touches this session made that this screen saw (0 = it has opened nothing yet). */
  touches: number;
}

/** A landing's mark on a module. Celebrated once (when `celebrate`), then it rests as a badge. */
export interface HeatStamp {
  module: string;
  /** When this screen saw the landing (the fold's `now`) — the celebration's clock. */
  at: number;
  kinds: ("landed" | "verified")[];
  /** False for a landing that was already history when the screen opened: a badge, no celebration. */
  celebrate: boolean;
  sessionKey: string;
  /** Distinct sessions that landed work in this module since the screen opened. */
  count: number;
}

export interface RepoHeat {
  repo: string;
  /** When this screen first saw the repo — "the map since HH:MM". */
  since: number;
  /** First-seen order, bounded by `FILES_MAX`. */
  files: FileHeat[];
  session: HeatSession | null;
  prev: HeatSession | null;
  stamps: HeatStamp[];
  /** The previous pulse's tail keys for this repo's session — what makes an event NEW. */
  tailKeys: string[];
  /** Newest touch with a known time, any kind. */
  lastTouchAt: number | null;
  /** Sessions whose landing this screen saw. */
  landings: number;
}

export interface HeatAcc {
  /** False until the first pulse is folded: the first pulse's events are history, never arrivals. */
  primed: boolean;
  repos: Record<string, RepoHeat>;
  /** Keys of `pulse.latest` events already folded (bounded). */
  seen: string[];
}

export const EMPTY_HEAT: HeatAcc = { primed: false, repos: {}, seen: [] };

/** Files kept per repo; past it the coldest read-only files leave first (edits never do). */
export const FILES_MAX = 240;
/** Event keys remembered (the pulse carries ≤ 12). */
export const SEEN_MAX = 200;
