// AGENT ADMISSION (moonshot #8) — the pure artifact layer: splice a managed block into a customer's
// existing file, and render the unified diff a reviewer sees BEFORE anything is sent. No IO.
//
// This module exists because of one specific safety rule in `src/lib/github/write.ts`: `openDraftPr`
// REFUSES to write a path that already exists on the base branch, by design — it seeds STARTER
// artifacts, and merging a PR that replaced a real CODEOWNERS with a scaffold would delete the
// customer's content, fanned out across a whole fleet from one click. That refusal is load-bearing
// and is not being relaxed. A managed block is the other shape: it MERGES into an existing file and
// touches nothing outside its own markers, so it gets its own writer (`github/admission-write.ts`)
// built on these pure functions.
//
// The idempotency property is the whole point and is tested as such: splicing the same block into an
// already-spliced file returns the file BYTE-IDENTICAL, so a re-proposal produces an empty diff and
// no PR, rather than a stream of no-op reviews nobody reads.

/** The result of splicing a managed block: the new content and whether anything actually changed. */
export interface SpliceResult {
  content: string;
  changed: boolean;
  /** Whether the file already carried a managed block (an UPDATE rather than a first APPEND). */
  replaced: boolean;
}

/**
 * Replace the region between `begin` and `end` with `block`, or append it when no such region
 * exists. Everything outside the markers is preserved byte-for-byte.
 *
 * Marker matching is line-anchored and exact. A begin with no matching end is treated as NO managed
 * region (so the block is appended and the stray marker is left alone) rather than as "delete
 * everything from here down" — a half-written marker in a customer's file must never authorize the
 * deletion of the rest of it.
 */
export function spliceManagedBlock(base: string, block: string, begin: string, end: string): SpliceResult {
  const lines = base.split("\n");
  const from = lines.findIndex((l) => l.trimEnd() === begin);
  const to = from === -1 ? -1 : lines.findIndex((l, i) => i > from && l.trimEnd() === end);
  const blockLines = block.split("\n");

  if (from !== -1 && to !== -1) {
    const next = [...lines.slice(0, from), ...blockLines, ...lines.slice(to + 1)];
    const content = next.join("\n");
    return { content, changed: content !== base, replaced: true };
  }
  // Append. A trailing newline is normalized so a file that ends with one and a file that does not
  // both produce exactly one blank separator line — otherwise the "unchanged" comparison on the next
  // run trips on whitespace and re-opens a PR forever.
  const trimmed = base.replace(/\s*$/, "");
  const content = (trimmed ? `${trimmed}\n\n` : "") + block + "\n";
  return { content, changed: content !== base, replaced: false };
}

/** True when `base` already contains exactly `block` inside its markers — the no-op predicate. */
export function managedBlockIsCurrent(base: string, block: string, begin: string, end: string): boolean {
  return !spliceManagedBlock(base, block, begin, end).changed;
}

// ---------------------------------------------------------------------------
// Unified diff
// ---------------------------------------------------------------------------

/**
 * A minimal unified diff, rendered for HUMAN REVIEW before a write is sent. Deliberately dependency-
 * free and deliberately not a real Myers diff: this is a preview of a managed-block splice, where
 * the change is one contiguous region, so a common-prefix / common-suffix trim produces exactly the
 * hunk a reviewer needs and cannot mis-attribute a line.
 *
 * Returns "" when nothing changes — an empty diff is the signal the caller uses to refuse to open a
 * PR at all, which is what makes the whole proposal flow idempotent.
 */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return "";
  const a = before === "" ? [] : before.split("\n");
  const b = after.split("\n");

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const ctxStart = Math.max(0, head - context);
  const aEnd = a.length - tail;
  const bEnd = b.length - tail;
  const aCtxEnd = Math.min(a.length, aEnd + context);
  const bCtxEnd = Math.min(b.length, bEnd + context);

  const out: string[] = [
    `--- a/${path}`,
    `+++ b/${path}`,
    // 1-based line numbers, and a 0-length side is reported at line 0 the way `diff` itself does.
    `@@ -${a.length === 0 ? 0 : ctxStart + 1},${aCtxEnd - ctxStart} +${ctxStart + 1},${bCtxEnd - ctxStart} @@`,
  ];
  for (let i = ctxStart; i < head; i++) out.push(` ${a[i]}`);
  for (let i = head; i < aEnd; i++) out.push(`-${a[i]}`);
  for (let i = head; i < bEnd; i++) out.push(`+${b[i]}`);
  for (let i = aEnd; i < aCtxEnd; i++) out.push(` ${a[i]}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// The manifest `controls.oversight` block
// ---------------------------------------------------------------------------

/**
 * Render `controls.oversight` for `.ai/manifest.yaml`, in the same regex-friendly YAML subset the
 * zero-dep doctor reads (`standard/manifest.ts` — flow lists, two-space indent, no anchors).
 *
 * OVERSIGHT METADATA, NEVER A THRESHOLD. It records WHO reviews AI work in this repo and what
 * provenance the org requires; it does not declare a bar. The bar lives in the `GatePolicy` fold, and
 * keeping these two apart is why this needs no `MANIFEST_SCHEMA_VERSION` bump — the spec's field
 * table is unchanged, `controls:` simply carries one more optional key, and `types.test.ts` (which
 * pins the constant to the `.ai/SPEC.md` header) stays green.
 */
export function renderManifestOversight(o: { tier: string; review: string; provenance: string[] }): string {
  const lines = [
    "  # Managed by Ascent from this organization's AI stance (moonshot #8). OVERSIGHT METADATA, not",
    "  # a gate threshold: it records who reviews AI work here. The bar itself lives in the org's",
    "  # gate policy, which a repository cannot lower.",
    "  oversight:",
    `    tier: ${o.tier}`,
  ];
  // A review sentence is free text a human wrote; quote and escape it so a colon or a `#` in the
  // sentence cannot restructure the document the doctor then parses.
  if (o.review) lines.push(`    review: ${yamlQuote(o.review)}`);
  if (o.provenance.length) lines.push(`    provenance: [${o.provenance.join(", ")}]`);
  return lines.join("\n");
}

function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/**
 * Splice `controls.oversight` into an existing manifest's `controls:` block, or return null when the
 * manifest has no `controls:` key at all.
 *
 * Null rather than "invent the block": a manifest with no `controls:` is either not this spec or was
 * hand-written to a different shape, and appending a nested key under a heading that does not exist
 * produces a file the doctor cannot read. The caller reports that honestly instead.
 */
export function spliceManifestOversight(manifest: string, block: string): string | null {
  const lines = manifest.split("\n");
  const at = lines.findIndex((l) => l.trimEnd() === "controls:");
  if (at === -1) return null;
  // The block ends at the next line that is neither blank nor indented — i.e. the next top-level key.
  let end = at + 1;
  while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]!))) end++;
  // Drop any oversight block we previously wrote, so this is idempotent the same way the CODEOWNERS
  // splice is: find `  oversight:` inside the region and cut to the end of ITS nesting.
  const existing = lines.findIndex((l, i) => i > at && i < end && l.trimEnd() === "  oversight:");
  if (existing !== -1) {
    let oEnd = existing + 1;
    while (oEnd < end && /^ {4,}/.test(lines[oEnd] ?? "")) oEnd++;
    // Carry the comment lines directly above the block out with it, so re-running does not stack them.
    let oStart = existing;
    while (oStart > at + 1 && /^ {2}#/.test(lines[oStart - 1] ?? "")) oStart--;
    lines.splice(oStart, oEnd - oStart);
    end -= oEnd - oStart;
  }
  // Insert before any trailing blank lines in the region, so the key lands inside `controls:`.
  let insertAt = end;
  while (insertAt > at + 1 && lines[insertAt - 1] === "") insertAt--;
  lines.splice(insertAt, 0, ...block.split("\n"));
  return lines.join("\n");
}
