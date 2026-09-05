// ANCHORED IDENTITY DIFFS — how Athena's self-model changes, and the ONLY way it changes.
//
// Registry doctrine `anchored-identity-diffs`. Three rules, none of them negotiable:
//
//   1. THE ANCHOR IS EXACT CONTENT, NEVER A LINE NUMBER. The document changes constantly (every
//      accepted proposal edits it), so a positional anchor is correct only until something above it
//      moves — and then it is silently wrong, editing the wrong line with full confidence.
//   2. A MISMATCH FAILS LOUDLY. There is NO fallback to appending at the end. That fallback is the
//      failure that looks like success: the edit "lands", nobody is told it missed, and the document
//      slowly fills with orphaned restatements of changes that were meant to REPLACE something. A
//      self-model that accumulates contradictions is worse than one that refuses an edit.
//   3. AN ANCHOR THAT MATCHES TWICE IS AMBIGUOUS, NOT A COIN FLIP. Picking the first match is a
//      guess, and a guess about identity is exactly the thing this module exists to prevent.
//
// Consequences of those rules that are also deliberate:
//   • There is NO operation that rewrites the whole document. Every op names one section and (except
//     for `append`) one anchored line inside it.
//   • Only the named section is touched — the rest of the document is returned byte-for-byte.
//
// PURE AND DEPENDENCY-FREE on purpose: no Prisma import, no `@/lib/db`, no I/O. The engine that
// decides what an identity becomes must be unit-testable without a database, and must be readable in
// one sitting by whoever next wonders whether a "small fallback" would be harmless. It would not.

/** One anchored edit to one `## ` section of the identity document. */
export type IdentityDiff =
  | { op: "append"; section: string; line: string }
  | { op: "replace"; section: string; anchor: string; line: string }
  | { op: "remove"; section: string; anchor: string };

/** Why an edit was refused. Every one of these is a REFUSAL — nothing was written. */
export type DiffFailureReason = "no-such-section" | "anchor-not-found" | "anchor-ambiguous";

export type DiffResult =
  | { ok: true; content: string }
  | { ok: false; reason: DiffFailureReason; detail: string };

/** A `## ` heading opens a section; everything up to the next `## ` (or EOF) is its body. `#` and
 *  `###` are NOT section boundaries — only the one level the document's structure is built from. */
const SECTION_RE = /^##\s+(.*\S)\s*$/;

/** The anchor comparison. "Exact content" means the line's text — trailing whitespace and a stray
 *  CR from a CRLF document are transport, not content, and must not make an anchor miss. */
const norm = (s: string): string => s.trim();

interface Section {
  /** Index of the heading line in the split array. */
  headingAt: number;
  /** First body line index (inclusive) and one-past-the-last (exclusive). */
  from: number;
  to: number;
}

/** Locate every `## ` section whose title matches `name`. Returns them in document order. */
function findSections(lines: string[], name: string): Section[] {
  const want = norm(name);
  const heads: number[] = [];
  for (let i = 0; i < lines.length; i++) if (SECTION_RE.test(lines[i]!)) heads.push(i);

  const out: Section[] = [];
  for (let h = 0; h < heads.length; h++) {
    const at = heads[h]!;
    const title = norm(SECTION_RE.exec(lines[at]!)![1]!);
    if (title !== want) continue;
    out.push({ headingAt: at, from: at + 1, to: heads[h + 1] ?? lines.length });
  }
  return out;
}

/** Body line indices in `[from, to)` whose content equals the anchor. */
function findAnchor(lines: string[], section: Section, anchor: string): number[] {
  const want = norm(anchor);
  const hits: number[] = [];
  for (let i = section.from; i < section.to; i++) {
    if (norm(lines[i]!) === want) hits.push(i);
  }
  return hits;
}

/**
 * Apply ONE anchored diff. Returns the new document, or a typed refusal — never a partial write and
 * never a repositioned edit.
 */
export function applyIdentityDiff(content: string, diff: IdentityDiff): DiffResult {
  const section = norm(diff.section);
  if (!section) {
    return { ok: false, reason: "no-such-section", detail: "the diff named no section" };
  }

  // CRLF is normalized to the document's dominant terminator on write; splitting on /\r?\n/ keeps a
  // mixed-terminator document from producing anchors that can never match.
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  const found = findSections(lines, section);
  if (found.length === 0) {
    return { ok: false, reason: "no-such-section", detail: `no "## ${section}" section in the document` };
  }
  if (found.length > 1) {
    // Two headings with the same title: which one an anchor "belongs to" is unknowable, and picking
    // one is the guess rule 3 forbids. Same class of failure, so the same typed reason.
    return {
      ok: false,
      reason: "anchor-ambiguous",
      detail: `"## ${section}" appears ${found.length} times — the target section is ambiguous`,
    };
  }
  const sec = found[0]!;

  if (diff.op === "append") {
    // Land after the section's last NON-BLANK line, so the blank line that separates this section
    // from the next survives instead of being pushed down by every append.
    let at = sec.to;
    while (at > sec.from && norm(lines[at - 1]!) === "") at--;
    const next = [...lines.slice(0, at), diff.line, ...lines.slice(at)];
    return { ok: true, content: next.join(eol) };
  }

  const anchor = norm(diff.anchor);
  if (!anchor) {
    return { ok: false, reason: "anchor-not-found", detail: `the ${diff.op} diff carried an empty anchor` };
  }
  const hits = findAnchor(lines, sec, diff.anchor);
  if (hits.length === 0) {
    // THE IMPORTANT BRANCH. No append-at-the-end fallback lives here, and none may be added: see
    // rule 2 at the top of the file. The caller is told the edit did not land.
    return {
      ok: false,
      reason: "anchor-not-found",
      detail: `no line matching ${JSON.stringify(anchor)} in "## ${section}"`,
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: "anchor-ambiguous",
      detail: `${hits.length} lines match ${JSON.stringify(anchor)} in "## ${section}"`,
    };
  }

  const at = hits[0]!;
  const next =
    diff.op === "replace"
      ? [...lines.slice(0, at), diff.line, ...lines.slice(at + 1)]
      : [...lines.slice(0, at), ...lines.slice(at + 1)];
  return { ok: true, content: next.join(eol) };
}

/**
 * Apply a SEQUENCE of diffs, all-or-nothing: the first refusal aborts and the original document is
 * what the caller still has. A proposal is accepted as a whole — half an identity change is a
 * document that states something nobody agreed to.
 */
export function applyIdentityDiffs(content: string, diffs: readonly IdentityDiff[]): DiffResult {
  let current = content;
  for (const diff of diffs) {
    const result = applyIdentityDiff(current, diff);
    if (!result.ok) return result;
    current = result.content;
  }
  return { ok: true, content: current };
}

/** The `## ` section titles a document offers, in order — what a proposal author may anchor into. */
export function identitySections(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => SECTION_RE.exec(l)?.[1])
    .filter((t): t is string => typeof t === "string")
    .map(norm);
}

/** Narrow unknown JSON (a proposal's `payloadJson`) to a well-formed diff. Returns null for anything
 *  that is not one of the three shapes — an unrecognized op must never be coerced into a known one. */
export function asIdentityDiff(value: unknown): IdentityDiff | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const section = typeof v.section === "string" ? v.section : null;
  if (!section) return null;
  const line = typeof v.line === "string" ? v.line : null;
  const anchor = typeof v.anchor === "string" ? v.anchor : null;
  if (v.op === "append") return line === null ? null : { op: "append", section, line };
  if (v.op === "replace") return line === null || anchor === null ? null : { op: "replace", section, anchor, line };
  if (v.op === "remove") return anchor === null ? null : { op: "remove", section, anchor };
  return null;
}
