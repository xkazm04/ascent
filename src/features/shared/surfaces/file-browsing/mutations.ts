// file-mutations: every write against the store is a race entered knowingly. Preflight is advisory;
// the store's answer at execution is the authority, and it is a TYPED verdict, never a thrown error.
// A bulk operation is N independent races reported per item. Every move-shaped intent — the
// "move to" action and the trash — passes through ONE guard door (`planMove`) that refuses what is
// wrong by geometry before the store is asked. The trash names its reaper at creation (TRASH_CAP).
// The sync agent (`churn`) is the other writer the browser never gets to consult. No React.

import { ROOT, TRASH, mulberry32, type Entry } from "./fixtures";
import { bump, children, isDescendant, trashRows, type Store } from "./store";

export type Verdict = "ok" | "gone" | "name-taken" | "root" | "read-only" | "empty-name";
export type Refusal = "onto-itself" | "into-own-descendant" | "root";
export type ConflictPolicy = "skip" | "keep-both" | "replace";
export type Outcome = "moved" | "trashed" | "restored" | "gone" | "conflict-skipped" | "replaced" | "kept-both";
export type ItemOutcome = { id: string; name: string; outcome: Outcome; detail?: string };
export type Report = { verb: "move" | "trash" | "restore" | "retry"; attempted: number; succeeded: number; outcomes: ItemOutcome[]; refused: { id: string; name: string; reason: Refusal }[]; reaped: number };

const FAILED: ReadonlySet<Outcome> = new Set(["gone", "conflict-skipped"]);
export const isFailure = (o: ItemOutcome): boolean => FAILED.has(o.outcome);

const write = (store: Store, patch: (m: Map<string, Entry>) => void): Store => {
  const m = new Map(store.entries);
  patch(m);
  return bump(store, m);
};

const siblingNamed = (store: Store, parentId: string, name: string, notId: string): Entry | undefined =>
  children(store, parentId).find((e) => e.name === name && e.id !== notId);

/** Advisory preflight — narrows the race window, cannot close it. The button copy says so. */
export function preflightRename(store: Store, id: string, name: string): Verdict {
  const e = store.entries.get(id);
  if (!e) return "gone";
  if (e.id === ROOT || e.id === TRASH) return "root";
  if (!e.readable) return "read-only";
  if (!name.trim()) return "empty-name";
  return siblingNamed(store, e.parentId, name.trim(), id) ? "name-taken" : "ok";
}

/** The rename itself: re-validated against the live store at fire time (one validation door). */
export function rename(store: Store, id: string, name: string): { store: Store; verdict: Verdict } {
  const verdict = preflightRename(store, id, name);
  if (verdict !== "ok") return { store, verdict };
  return { store: write(store, (m) => m.set(id, { ...m.get(id)!, name: name.trim() })), verdict: "ok" };
}

/** Rewrite a file's bytes in place: the content version bumps, and a corrupt file becomes readable. */
export function touch(store: Store, id: string): Store {
  const e = store.entries.get(id);
  return e ? write(store, (m) => m.set(id, { ...e, version: e.version + 1, corrupt: false })) : store;
}

/** THE guard door. Every move-shaped surface builds its operation list here. */
export function planMove(store: Store, ids: Iterable<string>, targetId: string): { ops: string[]; refused: Report["refused"] } {
  const ops: string[] = [];
  const refused: Report["refused"] = [];
  for (const id of ids) {
    const e = store.entries.get(id);
    const name = e?.name ?? id;
    if (id === ROOT || id === TRASH) refused.push({ id, name, reason: "root" });
    else if (id === targetId) refused.push({ id, name, reason: "onto-itself" });
    else if (e?.isDir && (targetId === id || isDescendant(store, targetId, id))) refused.push({ id, name, reason: "into-own-descendant" });
    else ops.push(id);
  }
  return { ops, refused };
}

const keepBothName = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (2)${name.slice(dot)}` : `${name} (2)`;
};

/** Apply the planned ops independently; one failure never aborts the rest. Per-item outcomes. */
export function executeMove(store: Store, ops: string[], targetId: string, policy: ConflictPolicy): { store: Store; outcomes: ItemOutcome[] } {
  const outcomes: ItemOutcome[] = [];
  let cur = store;
  for (const id of ops) {
    const e = cur.entries.get(id);
    if (!e) {
      outcomes.push({ id, name: id, outcome: "gone", detail: "source no longer exists" });
      continue;
    }
    if (targetId === TRASH) {
      cur = write(cur, (m) => m.set(id, { ...e, parentId: TRASH, origin: e.parentId, trashedAt: cur.tick + 1 }));
      outcomes.push({ id, name: e.name, outcome: "trashed" });
      continue;
    }
    const clash = siblingNamed(cur, targetId, e.name, id);
    if (clash && policy === "skip") {
      outcomes.push({ id, name: e.name, outcome: "conflict-skipped", detail: `a different item already holds "${e.name}"` });
    } else if (clash && policy === "replace") {
      cur = write(cur, (m) => {
        m.delete(clash.id);
        m.set(id, { ...e, parentId: targetId });
      });
      outcomes.push({ id, name: e.name, outcome: "replaced", detail: `destroyed ${clash.kind} "${clash.name}" (v${clash.version})` });
    } else if (clash) {
      const name = keepBothName(e.name);
      cur = write(cur, (m) => m.set(id, { ...e, parentId: targetId, name }));
      outcomes.push({ id, name: e.name, outcome: "kept-both", detail: `now "${name}"` });
    } else {
      cur = write(cur, (m) => m.set(id, { ...e, parentId: targetId }));
      outcomes.push({ id, name: e.name, outcome: "moved" });
    }
  }
  return { store: cur, outcomes };
}

/** The trash names its reaper: past this many items the oldest are permanently removed. */
export const TRASH_CAP = 20;

export function reapTrash(store: Store): { store: Store; reaped: number } {
  const rows = trashRows(store);
  const over = rows.length - TRASH_CAP;
  if (over <= 0) return { store, reaped: 0 };
  const doomed = rows.slice(0, over);
  return { store: write(store, (m) => doomed.forEach((e) => m.delete(e.id))), reaped: over };
}

export function restoreFromTrash(store: Store, id: string): { store: Store; outcome: ItemOutcome } {
  const e = store.entries.get(id);
  if (!e) return { store, outcome: { id, name: id, outcome: "gone", detail: "already reaped" } };
  const home = e.origin && store.entries.get(e.origin) ? e.origin : ROOT;
  const next = write(store, (m) => m.set(id, { ...e, parentId: home, origin: undefined, trashedAt: undefined }));
  return { store: next, outcome: { id, name: e.name, outcome: "restored", detail: home === e.origin ? undefined : "origin gone; landed in the root" } };
}

/** The other writer: deletes one, renames one, rewrites one image's bytes — without asking the view.
 *  Inside a small nested folder it removes the folder itself: the location the view stands in is gone. */
export function churn(store: Store, seed: number, location: Entry | undefined, candidates: Entry[]): { store: Store; journal: string[] } {
  const rnd = mulberry32(seed);
  const leaves = candidates.filter((e) => !e.isDir && e.readable);
  if (location && location.parentId !== ROOT && location.id !== ROOT && candidates.length <= 6) {
    const doomed = [location.id, ...candidates.map((e) => e.id)];
    return { store: write(store, (m) => doomed.forEach((id) => m.delete(id))), journal: [`deleted folder ${location.name}/ and its ${candidates.length} entries`] };
  }
  if (leaves.length === 0) return { store, journal: ["nothing to touch here"] };
  const pick = (): Entry => leaves[Math.floor(rnd() * leaves.length)];
  const [gone, renamed, rewritten] = [pick(), pick(), leaves.find((e) => e.kind === "image") ?? pick()];
  const journal: string[] = [];
  const next = write(store, (m) => {
    m.delete(gone.id);
    journal.push(`deleted ${gone.name}`);
    if (renamed.id !== gone.id) {
      const dot = renamed.name.lastIndexOf(".");
      const name = dot > 0 ? `${renamed.name.slice(0, dot)}~1${renamed.name.slice(dot)}` : `${renamed.name}~1`;
      m.set(renamed.id, { ...renamed, name });
      journal.push(`renamed ${renamed.name} → ${name}`);
    }
    if (rewritten.id !== gone.id) {
      const cur = m.get(rewritten.id)!;
      m.set(rewritten.id, { ...cur, version: cur.version + 1, corrupt: false });
      journal.push(`rewrote ${cur.name} (v${cur.version + 1})`);
    }
  });
  return { store: next, journal };
}
