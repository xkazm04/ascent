// House prose style for everything a model writes on Ascent's behalf, enforced at BOTH ends.
//
// THE PROBLEM. A large share of the text users actually read here is written at scan time, not by us:
// report headlines and summaries, per-dimension rationales, roadmap items, risks, the executive
// briefing narrative, memory reflections. Every frontier model reaches for the em dash constantly, so
// scrubbing the em dashes out of this repository's own strings would leave the most-read prose in the
// product untouched, and every future scan would put them straight back.
//
// TWO ENDS, BECAUSE ONE IS NOT ENOUGH. `PROSE_STYLE_RULE` goes in the prompts, which handles the
// common case and keeps the phrasing GOOD (the model recasts the sentence rather than swapping in a
// comma). `deEmDash` is the backstop in the parse path, because a style instruction is a request: a
// model under load, on a fallback provider, or one that simply drifts will ignore it, and the whole
// point of this change is that a user never sees one. The prompt rule keeps quality; the backstop
// keeps the guarantee.
//
// `deEmDash` is a repair, not a stylist. It cannot recast a sentence, so it aims for the least-bad
// mechanical result and nothing more. Judge it by "does this read acceptably", not by "is this how a
// writer would have phrased it" — that is the prompt's job.

const EM_DASH = "—";

/**
 * The style instruction injected into every prompt whose output a user reads. Written as an absolute,
 * with the substitutions spelled out, because "avoid em dashes" alone reliably produces a page of
 * double hyphens instead.
 */
export const PROSE_STYLE_RULE = [
  "STYLE: write the way a person writes, not the way a model does.",
  "- Never use an em dash (—) anywhere in your output. Not as a connector, not for an aside, not for emphasis.",
  "- Do not substitute a double hyphen (--), a spaced hyphen ( - ), or an en dash (–) for one either.",
  "- Where you would reach for one, do one of these instead: recast the sentence so it needs no break,",
  "  split it into two sentences, use a colon if you are genuinely introducing something, use parentheses",
  "  for a true aside, or use a comma for a light pause.",
  "- Vary those choices. A colon every time is just as recognizable as a dash every time.",
].join("\n");

/**
 * Strip em dashes from model-written prose, leaving the closest neutral punctuation.
 *
 * PURE and idempotent. The order of the rules matters: the specific cases (already-punctuated,
 * line-edge, before terminal punctuation) have to run before the general connector rule, or the
 * general rule turns every one of them into a stray comma.
 *
 * Deliberately NOT applied to markdown fenced code: no caller passes fenced content through here, and
 * detecting fences correctly is not worth the false positives on prose that happens to contain a
 * backtick. Model prose that is meant to be code goes through the JSON contract instead.
 */
export function deEmDash(s: string): string {
  if (!s.includes(EM_DASH)) return s;
  return (
    s
      // Already punctuated ("X, — Y"): the dash adds nothing, so drop it and keep the punctuation.
      .replace(/([,;:])\s*—\s*/g, "$1 ")
      // At the start of the text or a line, a dash is decoration, not a connector.
      .replace(/(^|\n)[ \t]*—[ \t]*/g, "$1")
      // Same at the end, where there is no second clause for it to join to.
      .replace(/[ \t]*—[ \t]*($|\n)/g, "$1")
      // Immediately before terminal punctuation it is joining a clause to nothing.
      .replace(/\s*—\s*([.!?])/g, "$1")
      // Before a closing bracket/quote, likewise.
      .replace(/\s*—\s*([)\]"'”])/g, "$1")
      // After an opening bracket/quote, likewise.
      .replace(/([([“"'])\s*—\s*/g, "$1")
      // Everything left is a genuine connector between two clauses. A comma is the closest neutral
      // equivalent that never changes meaning; a colon would assert a relationship the model may not
      // have intended.
      .replace(/\s*—\s*/g, ", ")
      // Never leave a doubled separator behind from the substitutions above.
      .replace(/,\s*,/g, ",")
      .replace(/,\s*([.!?;:])/g, "$1")
      // Collapse only the extra spaces the substitution itself can introduce. Deliberately not a
      // global whitespace squeeze: two trailing spaces are a markdown line break, and indentation is
      // meaningful in the briefing narrative.
      .replace(/, {2,}/g, ", ")
  );
}

/** True when the text still contains an em dash. For tests and for asserting the backstop held. */
export function hasEmDash(s: string): boolean {
  return s.includes(EM_DASH);
}
