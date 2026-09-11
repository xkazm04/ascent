#!/usr/bin/env node
/** `node scripts/check-contract-duplication.mjs` — how many revisions of a
 *  contract-bearing dependency are actually present in the resolved tree.
 *
 *  WHY THIS IS NOT ANSWERED BY package.json. A publisher that versions its API
 *  contract by IMPORT PATH (a dated entry point such as `<pkg>/2026-10`) moves the
 *  binding decision to whoever writes the reference — and when we reach that
 *  publisher through a wrapper (an adapter, a framework integration), the wrapper
 *  writes the inner reference, not us. Our manifest then states one dependency at
 *  one range while the resolved tree holds several copies at several versions, each
 *  reached by a different path, each capable of carrying a different contract. The
 *  declaration cannot see this by construction: it records what we asked for, and
 *  the question is what we got.
 *
 *  So the report is a PAIRED one. The same question — "how many revisions of this
 *  contract are present?" — is answered twice, once from the declaration and once
 *  from the lockfile, and the gap between the two answers is the finding.
 *
 *  Reads package.json and package-lock.json only. No network, no install, no
 *  writes. Exits 0 always: this is a report, not a gate.
 *
 *  Run:  node scripts/check-contract-duplication.mjs [--json]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const asJson = process.argv.includes("--json");

/** Dependency families whose API contract is versioned by the publisher, so a split
 *  in the resolved tree is a CONTRACT split rather than a disk-space complaint.
 *  `control` marks a family expected to resolve to exactly one copy — without one,
 *  a report that only ever says "dirty" cannot be distinguished from an instrument
 *  that says "dirty" unconditionally. */
const FAMILIES = [
  { scope: "@polar-sh/sdk", why: "billing contract — dated API versions, pinned by import path" },
  { scope: "next", why: "control: expected single copy", control: true },
];

const read = (f) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));

const pkg = read("package.json");
const lock = read("package-lock.json");
const declaredDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

/** Arm A — the declaration. What our own manifest says about this family. */
function declaredArm(scope) {
  const ranges = Object.entries(declaredDeps)
    .filter(([name]) => name === scope)
    .map(([, range]) => range);
  return { ranges, revisions: new Set(ranges).size };
}

/** Arm B — the resolved tree. Every physical copy, with the path that reached it. */
function resolvedArm(scope) {
  const copies = Object.entries(lock.packages ?? {})
    .filter(([path]) => path.endsWith(`node_modules/${scope}`))
    .map(([path, meta]) => ({ path, version: meta.version ?? "?" }));
  return { copies, revisions: new Set(copies.map((c) => c.version)).size };
}

const results = FAMILIES.map((f) => {
  const a = declaredArm(f.scope);
  const b = resolvedArm(f.scope);
  return {
    scope: f.scope,
    why: f.why,
    control: Boolean(f.control),
    declaredRevisions: a.revisions,
    declaredRanges: a.ranges,
    resolvedRevisions: b.revisions,
    resolvedCopies: b.copies,
    // The claim under test: the two arms disagree, and only the second is informative.
    armsDisagree: b.revisions > a.revisions,
  };
});

if (asJson) {
  console.log(JSON.stringify({ results }, null, 2));
} else {
  console.log("contract duplication — declaration vs resolved tree\n");
  for (const r of results) {
    const tag = r.control ? " (control)" : "";
    console.log(`${r.scope}${tag}`);
    console.log(`  ${r.why}`);
    console.log(`  declared : ${r.declaredRevisions} revision(s)  ${r.declaredRanges.join(", ") || "(transitive only)"}`);
    console.log(`  resolved : ${r.resolvedRevisions} revision(s) across ${r.resolvedCopies.length} copy/copies`);
    for (const c of r.resolvedCopies) console.log(`             ${c.version}  <-  ${c.path}`);
    console.log(
      r.armsDisagree
        ? "  VERDICT  : arms DISAGREE — a revision is bound by a path we do not write.\n" +
            "             Pinning our own import cannot reach the wrapper's copy; the\n" +
            "             publisher must expose the contract selector at runtime, or the\n" +
            "             wrapper must pass ours through.\n"
        : "  VERDICT  : arms agree — one revision, the declaration is sufficient here.\n"
    );
  }
  const split = results.filter((r) => r.armsDisagree && !r.control);
  console.log(
    split.length
      ? `${split.length} contract family/families are split in the resolved tree.`
      : "no contract family is split."
  );
}
