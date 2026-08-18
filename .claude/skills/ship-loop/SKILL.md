---
name: ship-loop
description: Milestone-driven loop that drives ascent toward its three golden use cases — UC1 standardize a codebase for AI development (L1→L5 in quick iterations), UC2 share & improve AI-dev techniques across an org's codebases (skills + knowledge tracked and shared), UC3 individual care (help each developer use LLM dev tools better). Keeps a golden ledger (UC1/UC2/UC3 journey readiness) above a 9-dimension hygiene scorecard + append-only backlog (every item tagged with its use case), batches items into user-gated milestones (CP checkpoints), executes with atomic commits, and certifies each milestone with the full verification gate (lint/tests/build, then tsc sequentially). Resumable across sessions — all state lives in `.claude/ship-loop/` at the repo root. Invoke with `/ship-loop` (resumes) or `/ship-loop boot` (fresh loop after archiving prior state).
category: Development
memory: none
version: 2.0
---

# Ship Loop — milestone-driven progress toward the three golden use cases (ascent)

A permanent loop that moves the app toward its **ship bar — each golden use case runs end-to-end and is honest** — through scored audits, user-gated milestone picks, and hard verification gates. Any session can resume it: the state files are the single source of truth, and this file is the procedure.

## The three golden use cases (the value axis — read `docs/GOLDEN-USE-CASES.md` first)

| Tag | Use case | The journey the loop certifies |
|---|---|---|
| **UC1** | Standardize a codebase for the AI development process — a few quick iterations lift a repo from L1 to L5 | scan → gaps-to-explore → apply practice / `.ai/` foundation → rescan shows the lift |
| **UC2** | Share & improve AI-development techniques across an org's codebases — skills and knowledge actively tracked and shared | observe skills in the fleet → propose (PR) into a **customer-owned registry repo** → adopt per repo → invokes/drift/outcomes tracked → lessons → new version → redistributed. Ascent onboards/indexes/tracks the registry; it is never the registry itself, and nothing assumes the ascent repo |
| **UC3** | Individual care — help each developer use LLM dev tools to raise their own productivity | private reflection on real usage → interview → profile → moves → re-measure — via a skill shipped in the public distributable (`npx ascent mentor`) and seeded into each registry; only opt-in aggregates flow up to UC2 |

Every backlog item carries a tag `UC1|UC2|UC3|hyg` (`hyg` = engineering hygiene with no direct journey effect). Milestones are picked **per use case** — a milestone is "the next coherent slice of one journey", not a grab-bag by dimension. The old dimension 9 (value & market) is folded into the ledger: the value case *is* the three use cases.

> Origin note: adopted from the personas repo's ship-loop skill on 2026-07-27. Ascent already ran Boot→M9 of this loop during 2026-07-05 with no skill definition; this SKILL.md codifies the procedure, adapted to ascent's stack and the harness learnings recorded in `state.md`/`decisions.md`.

## State files (in `.claude/ship-loop/`, repo root — NOT next to this skill)

| File | Contract |
|---|---|
| `state.md` | Current truth: ship bar, **golden ledger** (UC1/UC2/UC3 each 🔴/🟡/🟢 + the one sentence that says what the journey can and cannot do today), hygiene scorecard, milestone status, harness notes. Rewrite freely; keep it one screen of load-bearing facts. |
| `backlog.md` | Item table `# / status / UC / dimension / size / description`. **Numbering append-only — never renumber.** Statuses: ☐ todo · ◐ in progress · ☑ done · ✕ cut. `UC` ∈ `UC1|UC2|UC3|hyg` — add the column to an existing backlog by tagging on first resume after v2.0 (a one-time pass, journaled). |
| `journal.md` | Append-only, one line per event (item done w/ commit SHA, CP resolution, gate result, root-caused saga). Never edit past lines. |
| `decisions.md` | CP answers from the user + auto-decisions taken while AFK (each marked "pending user review at CPn"). |
| `value-case.md` | Legacy dimension-9 synthesis (`docs/VALUE-CASE.md`). Superseded by the golden ledger; keep only as a pointer. |
| `archive-*/` | Frozen state of previous loops (different app or restarted loop). Read-only. |

## The golden ledger (value axis) + the 9 hygiene dimensions (gate axis)

**Golden ledger** — one row per use case in `state.md`: 🔴 journey broken/absent · 🟡 journey runs but a load-bearing step is missing, dishonest, or manual · 🟢 journey runs end-to-end, evidence-backed, tested. Each row names the *next slice* (the smallest change that moves the light) and links its backlog items. Re-judge the ledger with a **journey lens** at every checkpoint: walk the use case as its owner (UC1 platform lead, UC2 DevEx lead, UC3 a developer) and ask "can they complete the loop today, honestly?" — reuse `uat/characters/*` for the walk.

**Hygiene scorecard** — 1-Build & types · 2-Func(tional completeness) · 3-Tests · 4-Simulated UAT (Playwright e2e + `uat/` journeys) · 5-Billing & value capture (Polar) · 6-Auth & security (Supabase wall, route gating) · 7-UX/UI polish · 8-Ops (CI/migrations/context-map hygiene) · 9-*(retired into the ledger)*. Each 🔴/🟡/🟢. Dimension 4 is run as a **lens** (audit pass that emits backlog items). Hygiene is the gate, not the goal: a hygiene item is picked when it blocks a journey slice or when the gate is red.

## Phases

### Boot (`/ship-loop boot` — only for a fresh loop)
1. Archive any existing `.claude/ship-loop/` contents to `.claude/ship-loop/archive-<slug>/`.
2. Run the **journey lens** per use case (walk UC1/UC2/UC3 end-to-end against the current code; `docs/GOLDEN-USE-CASES.md` lists the known holes) → the golden ledger + UC-tagged items; then the hygiene lenses (build health, functionality honesty vs docs, test coverage of load-bearing paths, security posture, ops/CI path) → `hyg` items. Seed `backlog.md` + `state.md`.
3. **CP0**: present ledger + scorecard + backlog to the user; confirm the ship bar (default: all three lights 🟢), cadence, and which use case the first milestone serves. If AFK, record provisional picks in `decisions.md` and proceed on the least-destructive batch.

### Resume (default)
1. Read `state.md`, then `backlog.md` and the tail of `journal.md`. Do NOT re-audit what the scorecard already scores — but if many commits have landed since the last journal entry, re-run the gate and premise-check open items before trusting the scorecard.
2. Scan `git status` for foreign in-flight WIP (ascent's tree often carries large uncommitted WIP that is not the loop's).
3. Continue: an in-flight milestone → keep executing; a completed one → run/finish its gate; gate green → next checkpoint.

### Checkpoint (CPn — before each milestone)
- Present: ledger delta, scorecard delta, recommended next milestone (a coherent slice of ONE use case's journey, usually 3-8 items; hygiene items only as blockers), and any product decisions the work needs. One question at a time, single-keystroke answerable.
- **AFK protocol**: ask twice ~60s apart; if silent, record a provisional pick in `decisions.md` (least-destructive option, marked for re-ask), avoid product-call edits while AFK, and never commit destructive changes on a provisional.
- Under **continuous cadence** (if the user picked it at CP0), proceed down the backlog by severity without a CP ask; stop only for blockers or product decisions.

### Execute (milestone)
- One backlog item = one atomic commit, referenced by SHA in `journal.md`. Fan out parallel subagents only for disjoint paths.
- **Never bundle the loop's changes with pre-existing uncommitted WIP.** If the tree is a WIP soup, stage only your paths (one `git reset -q && git add <paths>` invocation) — or defer the commit decision to the user and record it.
- Defer any item whose files are another session's hot area — mark it in `backlog.md` with the reason, don't fight over files.
- Premise-check before executing: audits overstate and backlogs go stale (item 37 was already shipped; item 15 was context-map drift, not a deleted route) — verify the claim against current code first; correct the backlog item if the premise moved.
- Respect repo conventions: max 300 LOC per `.tsx` (extract before committing an over-limit file); read `context-map.json` before editing and keep it accurate; read `node_modules/next/dist/docs/` before writing Next-specific code (16.3 preview, breaking vs training data).

### Gate (after every milestone — certifies it)
1. `npm run lint` (0 errors) · `npx vitest run` · `npm run build`.
2. **Then** `npx tsc --noEmit` — SEQUENTIALLY, after the build completes, never concurrently: `next build` rewrites `.next/types/validator.ts` mid-flight, so a concurrent tsc reads an inconsistent tree and reports spurious "does not satisfy AppRouteHandlerRoutes" errors (bitten at boot + M2; a clean `rm -rf .next && npm run build` then tsc disproved them). Test-only diffs may skip the build (tsc still runs against the last build's types).
3. `.tsx` touched → run the AGENTS.md 300-LOC check (PowerShell one-liner, `-LiteralPath` for bracket dirs); must return zero rows.
4. UI touched → Playwright mock-LLM e2e (`npx playwright test`) when feasible; journeys in `uat/` are the deeper UAT lens. Test-only diffs may justified-skip — record the justification.
5. Record the gate line in `journal.md`; flip milestone ☑ in `state.md`; update the scorecard **and re-judge the touched use case's ledger light** (a milestone that doesn't move or protect a light should say so).

### Wrap (session end)
Update `state.md` + journal entry (commit SHAs), leave no uncommitted loop work (or an explicit journaled deferral of the commit decision). The next session resumes from files alone.

## Invariants

- **User owns product calls.** Ship bar, scope narrowing, feature hide/delete, pricing/positioning, UC3 privacy boundaries (what may leave a developer's machine), security trade-offs are CP questions — never auto-decided, only provisionally deferred.
- **Journeys over dimensions.** A green hygiene scorecard with a red ledger is not progress; report the ledger first.
- **Honesty over green.** A gate that passes while the claim is unverified is not done — distinguish "code-verified" from "subagent-claimed" in every journal line.
- **Lenses emit items, items get numbers, numbers never change.** Every item carries its `UC` tag; untagged items are a boot/resume bug, not a category.
- **The gate is the build gate, not the product's `/api/gate`** — `npm run gate` is a product feature, excluded from verification.

---

## Skill Reflection

After the run’s real work is done, reflect twice — autonomously, without asking the user. Be honest about volume: most runs produce NOTHING for lane 2. An empty reflection is a valid result; a forced lesson is pollution. Calibration: nothing (common) / one line (sometimes) / a lesson entry (occasionally) / a redesign proposal (rare).

Lane 1 — PROJECT learnings (what the next session in THIS repo needs): write via the MEMORY BLOCK contract if this prompt carries one, else append node lines to `.personas/memory-outbox.jsonl` per that contract. Project-specific insight only.

Lane 2 — METHOD learnings (what would improve THIS SKILL for every project):
1. If nothing generalizes beyond this repo, stop here.
2. Append an entry to `LESSONS.md` in this skill’s directory: `## <version-used> — <YYYY-MM-DD> — <project-name>` followed by `- ` bullets (create the file with a `# Lessons — <skill>` heading if absent). Record the version the run USED, not a bump target. Wrap a bullet in a `### Redesign proposal` sub-block when it argues for a methodic redesign you are NOT applying now.
3. Version bump — ONLY when you also edit SKILL.md to apply the improvement in the same change: minor (1.2 → 1.3) for a prompt/step refinement, major (1.x → 2.0) for a methodic redesign. Update the `version:` frontmatter field (add `version: 1.1` if the file had none — absent means 1.0). Never bump without an applied edit; never edit the method without a bump.
4. Sync ritual (only when you bumped): (a) commit the skill directory as a STANDALONE commit on the current branch — message `skill(<name>): v<new> — <one-line reason>` — containing nothing but this skill’s files; (b) copy the updated skill directory to `~/.claude/skills/<name>/` (overwrite) so sibling projects can adopt it. EXCEPTION: read `.personas/skill-registry.json` first — if the library already carries a HIGHER version than yours, do not overwrite it; keep your lesson in LESSONS.md and note the version conflict in the entry.

Sibling awareness: `.personas/skill-registry.json` (repo root, when present) lists this skill’s installed version, the workspace library version, and which sibling projects run it at which version with recent usage. Use it to judge whether a lesson is worth a bump (heavily-used siblings raise the bar for majors) and to notice you are BEHIND (library newer than yours → prefer recording the lesson over editing a stale method).
