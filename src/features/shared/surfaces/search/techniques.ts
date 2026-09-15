// The drawer entries for the search scene: one per technique of the registry's `search` subject
// (authored against sha256:54682051824eb2b3, 2026-09-06), in the golden path's order. `mechanism`
// explains what the region does; `source` is the scene's own code; `inAscent` cites the real Ascent
// file that already realizes the technique (or null); `deviation` names where Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "query-parsing",
    title: "Query parsing",
    mechanism:
      "`parseQuery` is the one door: it walks the raw text honoring balanced quotes (an unbalanced quote is a literal, not an error), lifts `field:value` for the closed prefix set in SCHEMA into typed clauses — negated, and flagged unknown when the value is not in the vocabulary — keeps an unrecognized prefix as literal text and names it, and tokenizes the remainder through the same matcher the index used. " +
      "It bounds what it emits: tokens under two characters and terms past twelve are refused and reported on screen, never silently eaten. " +
      "The chips are the parse reflected back; removing one edits the text it came from. " +
      "`runLadder` then answers from the strictest rung that is non-empty and labels the descent, and a simulated outage returns a `failure` kind with a retry — spelled differently from zero matches.",
    source: S.SRC_PARSE,
    inAscent: {
      file: "src/lib/db/org-memory.ts",
      note: "`listOrgMemories` takes the raw `search` string and composes it as Prisma `contains` clauses (`mode: \"insensitive\"`) over three named fields — literal matching, so no engine syntax is reachable from user text.",
    },
    deviation:
      "Matching policy is re-derived per call site: `RegistryRepoPicker.tsx`, `useRepoSegmentsPanel.ts`, `followupsModel.ts` and `SecurityFindingsTable.tsx` each lowercase-and-`includes` inline; none folds diacritics, no surface has field prefixes or a labelled degradation, and an empty list and a failed fetch render alike.",
  },
  {
    slug: "full-text-indexing",
    title: "Full-text indexing",
    mechanism:
      "`toDocs` tokenizes three fields with one tokenizer whose two decisions — fold case and diacritics, split identifier humps — are toggles, and the pinned names show what each setting throws away; changing either rebuilds the index because the decision lives in the stored tokens. " +
      "`buildIndex` is an inverted index (postings per token with per-field term frequency, a sorted vocabulary for prefix lookup) and keeps its own `docIds`; the scan is the same `Engine` type, timed beside it, so the trade is visible at 50 rows and at 50,000. " +
      "The posture toggle decides whether deletions reach the index in the same update or lag until the named rebuild; under the lagging posture a deleted top result becomes a ghost hit the panel counts. " +
      "The drift check reads the index's own storage against the source and compares `!=`, so an index with more entries than the source is drift too.",
    source: S.SRC_INDEX,
    inAscent: {
      file: "src/lib/db/org-skills.ts",
      note: "`listOrgSkills` searches by Prisma `contains` over name and description — a database scan with declared scope, the correct posture at this corpus size; the Prisma schema carries relational `@@index` entries only.",
    },
    deviation: "No full-text index or tokenizer exists anywhere: every search is a substring scan (client-side over loaded rows, or Prisma `contains`), so word-boundary, multi-term and prefix semantics are unavailable and there is no derived artifact to reconcile.",
  },
  {
    slug: "ranking-and-excerpts",
    title: "Ranking and excerpts",
    mechanism:
      "`score` is the combination rule written down: saturating, length-normalized term frequency per field times the field weights declared with the index, scaled by rarity; the signals table in the region says why each earns weight. " +
      "`rankHits` sorts by score, then recency, then id — a total order, so two runs of one query cannot disagree, and the ties readout says how many top-score ties the tail broke. " +
      "`excerpt` finds the engine's matched tokens in the folded twin and applies the spans to the original text, windows on the densest cluster with honest ellipses, and returns text segments React renders — content is neutralized before a `<mark>` wraps it. " +
      "Because the marks come from `hit.matched`, a prefix-rung query for “indexi” highlights “indexing”; the readout counts the marks a naive re-find of the raw words would have missed. Scores never render; bands do.",
    source: S.SRC_RANK,
    inAscent: {
      file: "src/components/org/followups/followupsModel.ts",
      note: "`sortByValue` is a written-down, deterministic order — value rank, then projected points, then `title.localeCompare` as the final key — the total-order rule applied to a ranked list.",
    },
    deviation: "No search surface ranks by relevance: filtered lists keep their prior order (correct for the filter intent), and no surface produces an excerpt or marks a match, so a row's reason for appearing is never shown.",
  },
  {
    slug: "faceting-and-filters",
    title: "Faceting and filters",
    mechanism:
      "Four facets render from SCHEMA — the same authority the parser's prefixes come from — so a new vocabulary value cannot ship to the data and miss the filter. " +
      "`facetCounts` computes every count under the disjunctive convention by calling `passes(row, predicate, lift)` with the facet's own inclusion lifted; zero-count values stay visible and disabled. " +
      "Typed clauses from the text box and panel selections fold into ONE predicate (`withClauses`), and every active clause — the declared default exclusion included — renders as a removable chip in one row with a clear-all. " +
      "`isNarrowed` compares against the default, not emptiness, so the badge and the bar cannot disagree; `setPredicate` resets the page rather than clamping it; and the disclosure line names the set the counts cover (all text hits, not the page).",
    source: S.SRC_FACETS,
    inAscent: {
      file: "src/components/org/SecurityFindingsTable.tsx",
      note: "Facet options derive from the full row set so a dropdown never shrinks as you filter, and `withReset` re-opens the window at page one on any filter change — the reset-not-clamp rule.",
    },
    deviation:
      "No filter shows counts, `filtersActive` in `followupsModel.ts` tests emptiness rather than the default, and `ScopeFilterBar` renders the segment and stack scope with no chip row: an active scope is visible only in the selector it lives in.",
  },
  {
    slug: "saved-views",
    title: "Saved views",
    mechanism:
      "`toStored` promotes the current text, predicate and sort to a `ViewPredicate` — typed clauses as plain arrays — and a view re-runs that question against the corpus on apply; nothing stores rows. " +
      "The default slice is the first entry in the same list, and `mintViewId` mints an identity at creation that a rename never touches. " +
      "`validateView` checks every stored clause against the live SCHEMA at application time; the 2025 view's `tier` clause is dead, so the panel renders it as a broken chip, withholds results instead of widening them, and offers a repair that drops the clause. " +
      "`isDirty` compares the current state against the snapshot the application produced, showing the modified marker and the three exits: update, save as new, revert.",
    source: S.SRC_VIEWS,
    inAscent: {
      file: "src/lib/org/orgTabs.ts",
      note: "`TAB_SCOPED_PARAM_KEYS` and `buildOrgTabUrl` make selection and scope navigational state in the URL — the graduated form below a named view — and `clearedTabScopedParams` is the declared reset.",
    },
    deviation: "No named views exist: a filter set lives in component state and dies on navigation (followups, security, memory, skills), and the org tabs' URL state carries scope but not a free-text query or a filter set.",
  },
  {
    slug: "command-surface",
    title: "Command surface",
    mechanism:
      "`fuzzy` matches every typed character in order and scores the shape: a boundary hit (word start or case hump) earns five times an interior one, consecutive runs add, gaps subtract with distance, an exact prefix earns the largest bonus, and coverage rewards short labels — so `as` finds authService and not cache-parser. " +
      "`FLOOR` is a real rejection threshold; the readout counts what fell below it. " +
      "`rankItems` orders by score, then the session ledger (most recent first), then stable id, and an empty query lists the ledger — history breaks ties within the matched set and never admits a non-match. " +
      "The palette's commands are the scene's one registry, which the action strip renders too; the repository section is bounded and labelled (200 most recently updated); arrows move, enter runs the top hit, escape leaves state alone.",
    source: S.SRC_PALETTE,
    inAscent: null,
    deviation: "Ascent has no command palette and no keyboard-summoned navigation; the org rail (`ORG_NAV_GROUPS`) is the one registry a palette would derive from, and it is reached only by pointer.",
  },
  {
    slug: "typed-filter-language",
    title: "Typed filter language",
    mechanism:
      "`compileRule` is the rule box's one door: a lexer with spans, a recursive-descent parser over identifiers, literals, lists and operators, and `typeOf`, which synthesizes a type for every node bottom-up from a closed set — identifiers from `TYPING_CONTEXT`, the static twin of the row. " +
      "Every operator is a typing rule (equality wants one type, comparisons want ints, `contains` wants a list or string on the left, `matches` a string and a regex), and the root must be bool, so a well-typed `level + 1` is still refused as a program that is not a filter. " +
      "The verdict is a typed value carrying the offending span, rendered beside the input as “problem occurred here: …”; an accepted rule runs over every row on the page and cannot fail there. " +
      "Persisted rules pass the same door at load: the one saved under a retired `tier` field is marked broken and its lane shows nothing rather than everything. The validity table runs live, and `rules.test.ts` asserts it.",
    source: S.SRC_RULES,
    inAscent: null,
    deviation: "Ascent exposes no user-authored predicate language; the nearest surface is the AI stance (`src/lib/org/stance.ts`), a declared policy evaluated by fixed code rather than an expression a user writes and the product types.",
  },
];
