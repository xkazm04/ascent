#!/usr/bin/env node
// Parity hash for the mentor intake counter (study point 43). Claude Code's JSONL is undocumented and
// shifts between versions, so a refactor of the counter must prove "same counts on my real logs"
// without committing those logs. This runs two copies of the counter (two trees, or before/after a
// change) over the same local directory with the same pinned clock and prints only SHA-256 hashes.
//
//   node scripts/ascent-mentor-parity.mjs <treeA> <treeB> [projectsDir] [--now <ISO>]
//
// Exit 0 when the hashes match, 1 when they differ. Nothing from the logs, not even the counts, is printed.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** SHA-256 of the counter's JSON output. `counterPath` is a path to an ascent-mentor-intake.mjs. */
export async function parityHash(counterPath, projectsDir, now) {
  const mod = await import(pathToFileURL(resolve(counterPath)).href);
  const out = await mod.intake(projectsDir, { now: Date.parse(now) });
  return createHash("sha256").update(JSON.stringify(out)).digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const nowAt = args.indexOf("--now");
  const now = nowAt >= 0 ? args.splice(nowAt, 2)[1] : new Date().toISOString();
  const [treeA, treeB, dir = join(homedir(), ".claude", "projects")] = args;
  if (!treeA || !treeB) {
    console.error("usage: ascent-mentor-parity <treeA> <treeB> [projectsDir] [--now <ISO>]");
    process.exit(2);
  }
  const counter = (tree) => join(tree, "scripts", "ascent-mentor-intake.mjs");
  const a = await parityHash(counter(treeA), dir, now);
  const b = await parityHash(counter(treeB), dir, now);
  console.log(JSON.stringify({ now, a, b, same: a === b }));
  process.exit(a === b ? 0 : 1);
}
