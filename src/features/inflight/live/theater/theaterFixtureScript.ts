// THE DEMO'S ACTIVITY SCRIPT — what a real lane's pulse looks like second by second, deterministically.
//
// The first fixture read one file and edited one file per lane, which no real session does: a lane
// reads a dozen files across several modules, then edits a handful, and the pulse carries only the
// NEWEST of them (`filesRead`/`filesEdited` ≤ 8, `tail` = the last 6 events — `loop-pulse-fold.ts`).
// A hero that wants the whole picture must accumulate it across pulses, exactly as it will against
// production. So the script emits events on a cadence and the pulse shows the same bounded window.
//
// `planStep` is deliberately absent: the production stream never says which plan step an agent is on
// (lane-phase.ts), and a demo that showed one would prototype a signal the product cannot deliver.

import type { LaneActivity } from "@/lib/local/runner-types";

type RepoScript = { reads: readonly string[]; edits: readonly string[]; notes: readonly string[] };

const SCRIPTS: Record<string, RepoScript> = {
  "acme/kp": {
    reads: [
      "src/scoring/engine.ts",
      "src/scoring/claims.ts",
      "src/scoring/claims.test.ts",
      "src/scoring/guardband.ts",
      "src/analyze/signals.ts",
      "src/analyze/workflows.ts",
      "src/analyze/fetch.ts",
      "src/maturity/model.ts",
      "src/maturity/green.ts",
      "src/report/compare.ts",
      "src/report/diff.ts",
      "src/lib/format.ts",
      ".github/workflows/ci.yml",
      "docs/SCORING.md",
    ],
    edits: ["src/scoring/claims.ts", "src/scoring/claims.test.ts", "src/analyze/workflows.ts", "docs/SCORING.md"],
    notes: ["The claim table cites paths the model never saw", "Workflows sort past the prompt window", "Reserve three workflow slots"],
  },
  "acme/systedo": {
    reads: [
      "app/api/cases/route.ts",
      "app/api/cases/validate.ts",
      "app/api/cases/route.test.ts",
      "app/api/auth/session.ts",
      "lib/db/cases.ts",
      "lib/db/client.ts",
      "lib/validation/schema.ts",
      "lib/validation/errors.ts",
      "components/cases/CaseForm.tsx",
      "components/cases/CaseList.tsx",
      "package.json",
    ],
    edits: ["app/api/cases/validate.ts", "lib/validation/schema.ts", "app/api/cases/route.test.ts"],
    notes: ["Validation runs after the write", "Move the schema check ahead of the insert"],
  },
};

const READ_EVERY_S = 3;
const EDIT_EVERY_S = 7;
const READ_FROM = 20;
const EDIT_FROM = 60;
const WORK_UNTIL = 120;

const iso = (ms: number) => new Date(ms).toISOString();

/** Every event the scripted session has emitted by second `local` of its cycle, oldest first. */
function eventsUntil(s: RepoScript, local: number, cycleStart: number): LaneActivity[] {
  const out: LaneActivity[] = [];
  for (let sec = READ_FROM; sec <= Math.min(local, WORK_UNTIL); sec++) {
    const at = iso(cycleStart + sec * 1000);
    if (sec < EDIT_FROM && (sec - READ_FROM) % READ_EVERY_S === 0) {
      const path = s.reads[((sec - READ_FROM) / READ_EVERY_S) % s.reads.length]!;
      out.push({ at, kind: path.includes("/") && sec % 4 === 0 ? "search" : "read", path, tool: sec % 4 === 0 ? "Grep" : "Read", note: null });
    }
    if (sec >= EDIT_FROM && (sec - EDIT_FROM) % EDIT_EVERY_S === 0) {
      const i = (sec - EDIT_FROM) / EDIT_EVERY_S;
      const path = s.edits[i % s.edits.length]!;
      out.push({ at, kind: i % 3 === 2 ? "write" : "edit", path, tool: i % 3 === 2 ? "Write" : "Edit", note: null });
      if (i % 2 === 1) out.push({ at, kind: "text", path: null, tool: null, note: s.notes[i % s.notes.length]! });
    }
    if (sec >= EDIT_FROM && sec % 11 === 0) {
      const path = s.reads[sec % s.reads.length]!;
      out.push({ at, kind: "read", path, tool: "Read", note: null });
    }
  }
  return out;
}

const newestDistinct = (paths: (string | null)[], cap: number): string[] => {
  const seen: string[] = [];
  for (let i = paths.length - 1; i >= 0 && seen.length < cap; i--) {
    const p = paths[i];
    if (p && !seen.includes(p)) seen.push(p);
  }
  return seen;
};

/** The bounded window of a scripted lane's activity at second `local` — what a real pulse would carry. */
export function scriptedActivity(repo: string, local: number, cycleStart: number) {
  const s = SCRIPTS[repo];
  if (!s) return { tail: [], filesRead: [], filesEdited: [], diffStat: null, turns: null };
  const events = eventsUntil(s, local, cycleStart);
  const edits = events.filter((e) => e.kind === "edit" || e.kind === "write");
  const reads = events.filter((e) => e.kind === "read" || e.kind === "search");
  const edited = new Set(edits.map((e) => e.path));
  return {
    tail: events.slice(-6),
    filesRead: newestDistinct(reads.map((e) => e.path), 8),
    filesEdited: newestDistinct(edits.map((e) => e.path), 8),
    diffStat: edits.length > 0 ? { files: edited.size, plus: 9 * edits.length + (local % 5), minus: 3 * edits.length } : null,
    turns: events.length > 0 ? 2 + Math.floor(events.length / 2) : null,
  };
}
