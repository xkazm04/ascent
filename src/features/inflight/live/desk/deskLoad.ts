// THE DESK'S SERVER LOAD — the Ledger's load plus the rounds at lane grain and the lessons waiting for
// review, read once on the server. SERVER-ONLY: it reaches the db layer. `DeskTab` calls it.
//
// Each read is caught separately and NAMED when it fails (`failed`), the ledger's rule: a section that
// could not read says so instead of drawing a confident, empty, wrong chart.

import { listLoopRuns } from "@/lib/db/loop-runs";
import { listRoundLanes } from "@/lib/db/loop-rounds";
import { listLoopLessons } from "@/lib/db/loop-lessons";
import { listLocalPairings } from "@/lib/db";
import { selfHosted } from "@/lib/env";
import { loadLedger } from "../ledger/ledgerLoad";
import { DESK_ROUNDS, type DeskData, type DeskRead } from "./deskTypes";

async function attempt<T>(name: DeskRead, failed: DeskRead[], read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    failed.push(name);
    return null;
  }
}

export async function loadDesk(slug: string): Promise<DeskData> {
  const failed: DeskRead[] = [];
  const [ledger, rounds, pendingLessons, pairings] = await Promise.all([
    loadLedger(slug),
    attempt("rounds", failed, () => listLoopRuns(slug, DESK_ROUNDS)),
    attempt("lessons", failed, () => listLoopLessons(slug, "pending", 200)),
    selfHosted() ? listLocalPairings(slug).catch(() => []) : Promise.resolve([]),
  ]);
  const lanes = rounds ? await attempt("lanes", failed, () => listRoundLanes(slug, rounds.map((r) => r.id))) : null;
  return {
    ledger,
    rounds,
    roundsHasMore: (rounds?.length ?? 0) >= DESK_ROUNDS,
    lanes,
    pendingLessons,
    pairedRepos: pairings.filter((p) => p.localPath != null).map((p) => p.fullName),
    failed: [...new Set(failed)],
  };
}
