// ATHENA'S PROMPT — who she is, how she writes, what she may draw, and what she has been given.
//
// COMPOSITION ORDER IS THE DESIGN, and it runs identity → contract → evidence:
//
//   constitution   who she is and what she may never do (human-seeded, write-locked by the ABSENCE
//                  of a writer in athena-identity.ts)
//   self-model     what she has learned about THIS org (mutable only through an accepted diff)
//   tone contract  how she writes — checkable rules, never adjectives (see below)
//   block contract the two structured shapes she may emit, with their exact fences
//   ── then the evidence ──
//   recall         memories that may bear on the question — UNTRUSTED, quoted inside the boundary
//   grounding      whether she can call tools or is answering from the prompt alone
//   history        the last few turns, so a follow-up ("and the other one?") resolves
//   message        what the operator just said
//
// The identity and the contracts come FIRST and stay byte-identical across turns, which is also what
// keeps a provider's prompt cache warm. Everything that varies per turn is appended after.
//
// "BE CONCISE AND HELPFUL" IS NOT A CONTRACT. An adjective cannot be checked, so a model drifts back
// to headings, restated questions and a closing "Let me know if you'd like me to dig deeper!" within a
// few turns and nothing anywhere notices. Every rule below is a property someone could grep a reply
// for: a sentence count, a bare number, a `## ` at line start, a sign-off. That is what makes it a
// contract rather than a wish.
//
// THE UNTRUSTED BOUNDARY IS NOT OPTIONAL HERE. Memory content is written by org members, harvested
// from scanned repositories, and written by their agents — the same threat model
// src/lib/memory/consolidation.ts and reflection.ts already defend against. Athena is a NEW consumer
// of that store and she does not inherit the recall route's hole: every recalled body goes through
// `neutralize` and is quoted inside `wrapUntrusted`, under MEMORY_UNTRUSTED_BOUNDARY.

import { MEMORY_UNTRUSTED_BOUNDARY, neutralize, wrapUntrusted } from "@/lib/llm/untrusted";

/** How many prior turns are replayed into a prompt. Enough for a pronoun to resolve, few enough that
 *  a long thread does not price itself out of an answer. */
export const ATHENA_HISTORY_TURNS = 8;
/** Per-turn excerpt ceiling for replayed history. Applied AFTER neutralize — see the note there. */
const HISTORY_EXCERPT = 1_500;
/** Per-memory excerpt ceiling for recall. Applied AFTER neutralize, same reason. */
const RECALL_EXCERPT = 800;

export interface AthenaRecallItem {
  id: string;
  /** The stored body. FOREIGN-AUTHORED — never interpolated outside the boundary block. */
  content: string;
  kind?: string;
}

export interface AthenaPromptInput {
  /** Tier 1 identity. Null when the org has never been seeded — she still answers, without it. */
  constitution: string | null;
  /** Tier 2 identity. Null before her first accepted identity diff. */
  selfModel: string | null;
  /** Memories that may bear on this question. Quoted inside the untrusted boundary, always. */
  recall: AthenaRecallItem[];
  /** "tools" when she may call for data, "prefetched" when the prompt is all she gets. */
  grounding: "tools" | "prefetched";
  /** Oldest first. Trimmed to {@link ATHENA_HISTORY_TURNS} by the caller or here, whichever is smaller. */
  history: { role: "user" | "assistant"; content: string }[];
  /** What the operator just said. */
  message: string;
  /** Org slug, so she can name the fleet she is talking about rather than saying "your organization". */
  orgSlug: string;
}

/**
 * How she writes. Seven rules, each one a property of the OUTPUT TEXT rather than a mood.
 *
 * Rule 7 is the one that pays for `blocks.ts`: an enumeration of three or more comparable items is
 * the exact shape prose is worst at and a table is best at, and without a rule saying so a model will
 * write the wall every single time.
 */
export const ATHENA_TONE_CONTRACT = `HOW YOU WRITE. These are rules about the text you produce, and each one is checkable:

1. Lead with the answer in the first one or two sentences. The reasoning, the caveats and the context come after it, or not at all.
2. Never restate the question. "You asked about X" and "Great question" are both a wasted first line.
3. No paragraph runs longer than three sentences.
4. Every number carries its unit or the noun it counts — "14 repositories", "62 of 100", "up 8 points since June". A bare number is not an answer.
5. No headings. No "##", no bold section labels, no numbered outline of what you are about to say.
6. No sign-off. Do not close with an offer to help further, a summary of what you just said, or a question you invented for the operator to answer.
7. Three or more comparable items ALWAYS go in a block, never in a sentence or a bullet list. Comparing repositories, dimensions, months or scores is what the block formats exist for.`;

/** The two shapes she may draw, with the exact fences the parser recognises. The caps are stated
 *  because a model that knows the ceiling emits eight rows; one that doesn't emits thirty and gets
 *  cut. Both are safe (over-long is truncated, not dropped) — one just wastes tokens. */
export const ATHENA_BLOCK_CONTRACT = `STRUCTURED BLOCKS. When rule 7 applies, emit one of these fenced JSON blocks inline, in the place the enumeration would have gone. At most two blocks per reply.

A table (at most 4 columns, at most 8 rows; every row must have exactly as many cells as there are columns):

\`\`\`athena:table
{"title":"Fleet standing","columns":["Repository","Level","Overall"],"rows":[["acme/api","Practicing","62"],["acme/web","Emerging","41"]]}
\`\`\`

A chart (at most 8 x-values, at most 2 series; "chart" is "bar" or "line"; EVERY series must have exactly one value per label):

\`\`\`athena:chart
{"title":"Overall by month","chart":"line","labels":["Apr","May","Jun"],"series":[{"name":"Fleet average","values":[54,58,62]}]}
\`\`\`

A block whose structure does not validate is discarded entirely rather than drawn wrong, so a series with a missing value costs you the whole chart. Write a sentence of prose above the block; do not repeat the block's contents underneath it.`;

const GROUNDING_TOOLS = `GROUNDING. You can call tools for this organization's real data — its standing, its gate verdicts, its open recommendations, its declared AI stance, its proven practices, and its memory. Call them rather than guessing. If a tool says it has no data, say so plainly; an absence is a fact about this fleet and reporting it as a number would be a fabrication.`;

const GROUNDING_PREFETCHED = `GROUNDING. You have NO tools on this turn: everything you know is already in this prompt. Answer from it, and when it does not contain what was asked, say that you do not have it here rather than inferring a plausible number.`;

function section(heading: string, body: string | null | undefined): string | null {
  const b = body?.trim();
  return b ? `${heading}\n${b}` : null;
}

/**
 * The recall section. Returns null when nothing was recalled, so an empty section never appears —
 * a heading over "(none)" spends tokens telling the model about the absence of evidence.
 *
 * ORDER IS LOAD-BEARING: neutralize FIRST, cut SECOND — the order scoring/prompt.ts, consolidation.ts
 * and reflection.ts all use. Neutralizing GROWS the text (a forged `</untrusted_repo_data>` becomes
 * the 25-character `[boundary marker removed]`), so cutting first would let a memory dense in forged
 * markers expand back past the budget and crowd the prompt with attacker-chosen text.
 */
function recallSection(recall: AthenaRecallItem[]): string | null {
  const items = recall.filter((r) => typeof r?.content === "string" && r.content.trim());
  if (items.length === 0) return null;
  const body = items
    .map((r, i) => {
      const safe = neutralize(r.content);
      const excerpt = safe.slice(0, RECALL_EXCERPT);
      const clipped = safe.length > RECALL_EXCERPT ? " …[truncated]" : "";
      const kind = r.kind ? neutralize(r.kind) : "memory";
      return `[${i + 1}] kind=${kind}\n${excerpt}${clipped}`;
    })
    .join("\n\n");
  return `WHAT THIS ORGANIZATION HAS ALREADY RECORDED\n${MEMORY_UNTRUSTED_BOUNDARY}\n\n${wrapUntrusted(body)}`;
}

/**
 * Replayed history. Neutralized but NOT wrapped: these are the conversation's own turns, and quoting
 * the operator's own words inside an untrusted block would tell the model to disregard the very
 * request it is answering.
 *
 * The neutralize IS still needed, and for a specific laundering path: her own prior reply may quote a
 * memory body, so foreign text can re-enter through an assistant turn even though the memory itself
 * was wrapped when it first arrived. Stripping forged markers on the way back in closes that.
 */
function historySection(history: AthenaPromptInput["history"]): string | null {
  const turns = history.slice(-ATHENA_HISTORY_TURNS).filter((t) => t?.content?.trim());
  if (turns.length === 0) return null;
  const body = turns
    .map((t) => {
      const safe = neutralize(t.content);
      const excerpt = safe.slice(0, HISTORY_EXCERPT);
      return `${t.role === "user" ? "Operator" : "You"}: ${excerpt}${safe.length > HISTORY_EXCERPT ? " …[truncated]" : ""}`;
    })
    .join("\n\n");
  return `EARLIER IN THIS CONVERSATION\n${body}`;
}

/**
 * Compose the whole prompt. Pure: no database, no network, no clock — so a test can assert on the
 * exact string, which is how criterion 4 (recalled memory is inside the boundary) is checked.
 */
export function buildAthenaPrompt(input: AthenaPromptInput): string {
  const parts: (string | null)[] = [
    `You are Athena, the resident companion for the "${input.orgSlug}" organization on Ascent. You are org-scoped: every member of this organization talks to the same you, and what you remember you remember for all of them.`,
    section("WHO YOU ARE", input.constitution),
    section("WHAT YOU HAVE LEARNED ABOUT THIS ORGANIZATION", input.selfModel),
    ATHENA_TONE_CONTRACT,
    ATHENA_BLOCK_CONTRACT,
    input.grounding === "tools" ? GROUNDING_TOOLS : GROUNDING_PREFETCHED,
    recallSection(input.recall),
    historySection(input.history),
    `THE OPERATOR SAYS\n${input.message.trim()}`,
  ];
  return parts.filter((p): p is string => Boolean(p)).join("\n\n");
}

/**
 * What she says when no engine is configured. ONE quiet line, and it names the fixable thing.
 *
 * "She remembered nothing" and "she may not remember" are different facts and only one of them is a
 * bug someone can close, so the line says which of the two happened rather than apologising vaguely.
 * No model was called to produce this, which is the entire point.
 */
export const ATHENA_NO_ENGINE_REPLY =
  "I have no model engine configured on this deployment, so I can't reason over your fleet right now — everything I'd say would be guesswork. Set an LLM provider in the organization's settings and ask me again; nothing from this turn was remembered.";
