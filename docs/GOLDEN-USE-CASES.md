# The three golden use cases — and the designs for UC2 and UC3

_2026-08-17. Reframing note. Supersedes the "monetizable strengths" framing of
[`GOLDEN-TRIO.md`](GOLDEN-TRIO.md) as the **product's north star** (the Trio stays valid as the
market/moat analysis; this doc says what the product is *for*). The `/ship-loop` and `/tiger`
skills were re-versioned to 2.0 against these use cases in the same change. Implementation design —
the `Registry` and `Care` tabs, data model, indexer, delivery plan — is in
[`REGISTRY-AND-CARE-IMPL.md`](REGISTRY-AND-CARE-IMPL.md)._

## The three use cases

| # | Golden use case | Who | The loop | Ascent's job |
|---|---|---|---|---|
| **UC1** | **Standardize a codebase for the AI development process** — a few quick iterations move a repo from L1 → L5 quality | repo owner / platform lead | scan → gaps-to-explore → apply practice / `.ai/` foundation → rescan | make each iteration cheap, evidence-backed and structurally meaningful (D1–D9, the trust ladder) |
| **UC2** | **Share and improve AI-development techniques across an org's codebases** — knowledge *and skills* actively tracked and shared | DevEx / platform lead, skill authors | observe skills in the fleet → propose to the library → adopt per repo → track invokes / drift / outcomes → improve (lessons → version) → redistribute | the fleet-wide registry, telemetry and knowledge ladder no single-repo tool can offer |
| **UC3** | **Individual care** — help each developer use LLM dev tools to raise *their* productivity | the developer, privately | reflect on real usage → interview → personal profile → moves (skills / habits / settings) → re-measure | a private-first companion that never becomes surveillance; only opt-in aggregates flow up to UC2 |

Why these three, in this order: UC1 is what the scanner already does and what the market has
commoditized (see Trio §0); UC2 is where a fleet product is structurally advantaged; UC3 is the
reach engine — developers are the ones who actually invoke skills, and their sessions are the
only ground truth about whether a technique *works*. UC3 feeds UC2 (adoption + outcome signal),
UC2 feeds UC1 (the practices that lift a repo travel as skills), UC1 grounds UC3 (a developer's
sessions are read against the gaps of the repos they touch).

## What already exists per use case (ground truth, 2026-08-17)

**UC1** — the whole scan pipeline (`src/lib/scan.ts`, `analyze/**`, rubric r7, D1–D9, L1–L5 in
`src/lib/maturity/model.ts`), practice apply + PRs (`src/lib/practices/apply.ts`), the `.ai/`
foundation PR (`src/lib/standard/**`), gate API, passport with declines. Mature.

**UC2** — OrgSkill library + versioned push with optimistic concurrency, `scripts/ascent-skills.mjs`
(3-hash drift: `in_sync|diverged|stale|local_only|missing`), frontmatter contract
(`src/lib/org/skill-frontmatter.ts`, closed categories), dormancy `new|active|dormant`, before/after
skill outcomes, generated onboarding skill → promote, MCP read door, Org Memory (recall / reflect /
decay), practice mining + shapes. **The hole:** the `invoke` telemetry event was retired 2026-07-29
because *nothing produced it*, so `active` is unreachable and dormancy is meaningless; there is no
fleet-wide registry export; lessons/version history is invisible; the observed → proposed → adopted
knowledge ladder (Personas port 6) is unbuilt. The scan grades a repo's `.claude/skills` tree
(`passport-grades.ts`: none|adhoc|curated|governed) but never reads a SKILL.md.

**UC3** — `Organization.kind = personal`, `/me`, personal nav subset (overview / security / backlog /
skills / memory), per-person git-side AI attribution behind anti-surveillance floors
(`champions.ts`, `CHAMPION_MIN_POP=3`). Nothing reads how a developer actually *works with* the
tools; connector data (Copilot, Claude Code OTLP) is per-repo/day by design.

---

## The cloud topology (read before UC2/UC3)

Ascent is a SaaS. Its users **do not have the ascent repo**, and the SaaS's own database must not be
the only place a customer's skills and knowledge live (lock-in, no offline path, no git history, no
review flow). So the design separates four things that the first draft conflated:

| Piece | Where it lives | Owned by | Ascent's role |
|---|---|---|---|
| **The registry** — skill content, lessons, catalog | a **customer-owned neutral repo**, e.g. `acme/ai-skills` (private or public; more than one allowed, one marked canonical) | the customer, in git | **onboard** it (create/scaffold via the GitHub App, seed it), **index** it (it is scanned like any repo), **track** it (versions, adoption, drift, invokes, outcomes, lessons) |
| **The distributable** — CLI, hooks, the mentor bootstrap | a **public package**: `npx ascent …` (MIT, zero-dep like today's `scripts/ascent-skills.mjs`) and a mirror GitHub Action | ascent (open source), consumed without an account | the only code a developer runs locally; never assumes the ascent repo |
| **The tracker** — index, telemetry sink, fleet views, PR writer | the SaaS (`OrgSkill*` tables become an **index/mirror** of the registry, not the source of truth) | ascent | heatmaps, coverage, outcomes, candidate deck; opens PRs to registry and to repos; hosts the MCP door |
| **The pointer** — which registry a repo follows | `.ai/manifest.yaml` → `skills.registry: github:acme/ai-skills` (the vendor-neutral standard already has pointers-not-embeds) | each repo | reads it during scan; the CLI reads it locally |

Two operating modes, chosen per org at onboarding:
- **git-native (default, recommended)** — registry repo is canonical; every write to it is a **PR**
  (human adopts by merging = the "agents propose, humans adopt" ladder is git review, nothing new to
  learn); the SaaS indexes on scan/webhook.
- **hosted** — for orgs that don't want another repo: today's `OrgSkill` push path stays canonical
  (also the personal-workspace default). Same CLI verbs; `push` writes to the API instead of a PR.

Telemetry has two sinks for the same reason: the SaaS events API (default, token) or, for orgs that
forbid the SaaS sink, `ascent skills report --to-registry` commits rolling counts-only JSONL under
`telemetry/<repo>/<yyyy-mm>.jsonl` in the registry repo, which the indexer reads on scan.

**In the app:** a new `Registry` tab under the *Chosen* group owns onboarding (create / map / stay hosted),
migration of Skills · Practices · Memory into the registry, and tracking; the three existing tabs become
registry-backed views. UC3 gets a `Care` tab (personal mode = the developer's home; org mode = anonymized
aggregate under floors) — see `REGISTRY-AND-CARE-IMPL.md` §4–5.

**Ascent cannot use itself as the exemplar.** The dogfood path is: this repo runs the *distributable*
against a neutral registry repo of our own (e.g. `ascent-dev/ai-skills`), exactly as a customer would.

---

## UC2 design — skill onboarding & tracking (Personas' mechanisms, git-native and fleet-scaled)

Personas (single-operator desktop) solved this loop locally: transcript-mined invokes with an
age-guarded dormancy rule, a provenance sidecar → `sync_state`, a `skill-registry.json` for sibling
awareness, LESSONS.md + version bump as the improvement channel, memory-outbox → ledger →
per-skill coverage, and a harvest ladder `observed → proposed → adopted | deprecated | rejected`
(rejections retained, dedup-blocking 90 d). Ascent already carries the schema half. What follows
ports the *operational* half onto the cloud topology above.

### Principles
1. **Counts, not content.** Telemetry carries `skill, version, repo, event, ts` — never prompt or
   transcript text. Per-person attribution is off by default (UC3 owns the person; the org sees
   repos). Existing champion floors apply if a per-person view is ever added.
2. **Git is the door for content; the API is the door for counts.** Skill and lesson content enters
   the registry by PR (git-native) or the existing push API (hosted); telemetry enters through
   `POST /api/org/skills/events` or the registry telemetry folder. Sessions never touch a DB.
3. **Versions are the comparison currency; hashes only detect drift.** Already the CLI's stance.
4. **Agents propose, humans adopt.** No skill enters the registry or a repo without a merged PR
   (git-native) or an explicit accept (hosted).
5. **Honest zeros.** A skill with no invokes shows `0`; a repo with no applicable skills shows "n/a".
6. **No ascent-repo assumptions anywhere in the distributable.** It runs from `npx` in any repo,
   with or without an ascent account (offline: sync from the registry repo over plain git).

### Registry repo layout (scaffolded by ascent, owned by the customer)
```
ai-skills/
  README.md                       # what this is, how to sync, who owns it
  .ascent/registry.yaml           # {registry: v1, canonical: true, telemetry: api|registry|off, policies: {requireDescription, requireVersion, categories: [...]}}
  skills/<name>/SKILL.md          # frontmatter contract: name, description, category (closed set), memory, version, contexts?
  skills/<name>/LESSONS.md        # optional; append-only per the reflection contract
  catalog.json                    # GENERATED by ascent (bot PR/commit): [{name, version, category, contentHash, applicability, adopters:[repo@version], invokes30d}]
  telemetry/<repo>/<yyyy-mm>.jsonl   # only in telemetry: registry mode; counts only
  CODEOWNERS                      # who merges skill PRs = who adopts
```
`catalog.json` is the fleet analogue of Personas' `skill-registry.json`: sibling awareness for every
session that syncs, no account needed. The `## Skill Reflection` trailer in skills reads it
(fallback chain: `.ascent/skill-registry.json` local lock → registry `catalog.json` → Personas'
`.personas/skill-registry.json`).

### Phase A — onboard the registry + reopen the invoke channel
- **Onboarding flow (SaaS):** org Skills tab → "Set up a skills registry" → pick *create
  `<org>/ai-skills`* (GitHub App creates + scaffolds via an initial PR, reusing the `.ai/` foundation
  PR machinery in `src/lib/standard/pr.ts`) or *point at an existing repo*. Seed offer: the skills the
  fleet scan already observed (Phase D) as one PR per skill. Registry gets a `Repository.role =
  registry` flag so the indexer treats it specially and the fleet views exclude it from maturity math.
- **Distributable:** `npx ascent skills sync` (reads `.ai/manifest.yaml` → registry pointer; pulls
  by git, no account) · `push` (opens a PR to the registry with `baseVersion` semantics expressed as
  "PR must be against the version you synced" — conflicts surface as PR conflicts, not 409s) · `status`
  · `hooks install` (writes a Claude Code `PreToolUse[Skill]` + `SessionEnd` hook into
  `~/.claude/settings.json` with an `_ascent: true` marker; appends `{skill, version?, event:"invoke",
  ts, session}` to `<repo>/.ascent/skill-events.jsonl`; never blocks, never phones home itself) ·
  `report` (drains, dedupes on `(session, skill, ts)`, batches ≤500 to the API — or `--to-registry`).
  Fallback for devs without hooks: `report --mine-transcripts` walks `~/.claude/projects/<cwd>/*.jsonl`
  by byte watermark and extracts only Skill-tool invocations.
- **Server:** un-retire `invoke` (new migration; keep the 2026-07-29 fold as history), enum-validate
  `OrgSkillEvent.source ∈ cli|hook|ci|web|registry`, and let `skill-usage.ts` compute
  `new|active|dormant` with Personas' age guard (`firstSeenAt` < 30 d ⇒ `new`).
- Docs: `docs/features/org-knowledge/skills.md` — replace the "invoke retired / active unreachable"
  Known gap with the hook + report contract and the two modes.

### Phase B — index + fleet map
- **Indexer:** the scan reads SKILL.md frontmatter for every skill in the tree it already grades
  (`passport-grades.ts`) — in the registry repo (canonical versions) *and* in every fleet repo
  (adoption by name + content hash → `in_sync|stale|diverged|local_only`). Webhook on registry
  push refreshes the index. `OrgSkill` rows become mirror rows (`origin: registry|hosted`,
  `registryRepo`, `registryPath`, `registryHash`); the hosted write path stays for hosted mode.
- **`catalog.json`** is regenerated by ascent as a bot commit (or PR if the org's policy says so)
  after each index refresh — adopters, versions, invokes30d, applicability.
- **Fleet heatmap** on the org Skills tab (repo × skill: version chip coloured by sync state,
  invokes30d as intensity, dormant greyed) — Personas' `RegistryHeatmap` with repos for projects.
- **Applicability-based coverage:** a skill's denominator is the set of repos where it *applies* —
  from `category` mapped to a dimension (`testing`→D2, `ci-cd`→D3, `security`→D9, `docs`→D5,
  `ai-native`→D1/D4/D8, `workflow`→D7) and the repo's sub-band score (< `FOLLOW_UP_BELOW`=65 ⇒
  applies). Coverage = installed-and-active ÷ applicable, 30-day window; zero-count repos listed.

### Phase C — the improvement channel (lessons → version → redistribution)
- `LESSONS.md` lives beside each skill in the registry (a `push` carries it). The indexer parses it
  like Personas `skill_lessons.rs` (`versionUsed, date, repo, bullets[], redesign:boolean`) →
  `OrgSkillLesson` mirror rows. Skill detail gains a **Trace** view: version timeline from registry
  git history (resolves the `SkillGeneration` vs `skill-history.ts` ambiguity — history *is* git),
  lessons per version, per-repo drift.
- **Rollout:** "these N repos run < v2.0 → open PRs" through `practices/apply.ts`' shared write path
  (drift guard, PR tracking). Repos that sync via CLI just pull; ascent's PR is for the ones that don't.

### Phase D — the knowledge ladder (Personas port 6, git-shaped)
- **Observe:** the same indexer yields fleet-wide *observed skills* (name + hash, exemplar list) that
  are **not in the registry**.
- **Propose:** candidate deck on the org Skills tab: "`/deploy-check` observed in 4 repos, 3 versions
  diverged — propose to the registry?" → ascent opens a PR to `acme/ai-skills` from the exemplar
  (`adopt`), or records `reject (reason)` / `later`. Rejections retained, block re-proposal 90 d.
  Unknown categories are normalized to `other` in the PR (Personas' `unsorted/` quarantine).
- **Adopt** = the CODEOWNER merges. Merge → index refresh → `catalog.json` → next `sync` everywhere.
- `LESSONS.md` bullets fleet-wide → *observed knowledge* candidates into Org Memory
  (`kind: procedural`, `source: skill-lessons`), same one-door ingest.

### Phase E — tailored adopt (an LLM lane; a new `/tiger` call site)
Personas' `adoptTaskPrompt`/`shareTaskPrompt`: rewrite a generic skill's assumptions into *this*
repo's real commands, paths and domain — preserving `category/memory/version` verbatim — or
generalize a repo skill for the registry. Ascent grounds the prompt in the report it already has
(stack, detected commands, CLAUDE.md, context map) and delivers the result **as a PR to the target
repo** (`POST /api/org/skills/:name/tailor?repo=`), never as a silent file write. This is the second
LLM call site in the product; `/tiger` certifies it against `engine/_expected/tailored-adopt.md`
(grounding: does the repo's *detected* command set reach the prompt? never-throw validation;
frontmatter preserved by construction).

### Contracts to pin before building
- Event: `{skill, version?, event:"invoke"|"download"|"sync", ts, session?, source:"cli"|"hook"|"ci"|"web"|"registry"}`
  — batch ≤500, idempotent on `(session, skill, ts)`; identical line shape in the registry telemetry folder.
- Registry: `.ascent/registry.yaml` (declares mode + policies) and `catalog.json` (generated; the
  sibling-awareness file). Manifest pointer: `skills.registry` in `.ai/manifest.yaml`
  (spec bump 0.1.0 → 0.2.0, additive).
- Candidate: `{kind:"skill"|"lesson", name, contentHash, exemplars:[repo], category, version, dedupKey}`
  → one ingest door; git-native mode materializes accepted candidates as PRs.
- Privacy: no transcript text leaves the machine; hook events carry no prompt content; per-person
  never without opt-in (see UC3 `share`).

### Sequencing and why
A → B → D → C → E. A gives customers a registry they own on day one and turns two shipped-but-dead
features (dormancy, outcomes) back on. B is the demo moment ("your fleet's skill map"). D fills the
registry without asking anyone to author. C makes it *improve*. E is the only LLM spend and needs
Tiger before it's trusted. Dogfood every phase from this repo against `ascent-dev/ai-skills`, never
against the ascent repo itself.

---

## UC3 design — individual care

**The question was: a new scan, or a skill that reflects with the developer?** Answer: **a local
skill first, with an opt-in personal-workspace lens second — never a scan of people.** Reasons:
(1) the only ground truth about how a developer works with LLM tools is on their machine
(`~/.claude/projects/*.jsonl`, settings, hooks); the SaaS can't and shouldn't see it; (2) a scan
scores; care *reflects* — the developer must own the profile and choose what leaves; (3) tasks and
needs vary too much for a fixed rubric — the loop must **interview**, not assume; (4) the personal
workspace (`Organization.kind=personal`, `/me`) already exists as the lens for what the developer
opts to share.

### Where the mentor lives (cloud fit)
- The **engine** ships in the public distributable (`npx ascent mentor init` installs
  `~/.claude/skills/mentor/`) — no ascent repo, no account required for `intake|retro|weekly|moves`.
- The **org's copy** is seeded by ascent into every registry it onboards (`skills/mentor/`), so the
  org can extend the move catalogue and the interview by PR, and `sync` keeps developers on the org's
  version. Personal registries (`<user>/ai-skills`) get the same seed.
- **Grounding from the cloud** happens through doors that already exist: the SaaS **MCP endpoint**
  (`POST /api/mcp`: `get_repo_standing`, `list_open_recommendations`, `get_practice_shape`) with a
  personal token for the repo's gaps, and the registry's `catalog.json` for "which skills exist and
  what the fleet's invokes/outcomes say". Offline: catalog only.
- All personal state under `<repo>/.ascent/mentor/` (gitignored by the installer) plus
  `~/.ascent/mentor/profile.md`.

### The skill — `/mentor` (working name; alternatives `/coach`, `/reflect-me`)

| Mode | Trigger | What it does |
|---|---|---|
| `intake` | first run | (1) mine the last 30 d of local transcripts for the repos of this org — *counts and shapes only*: sessions/week, turns/session, tool mix, plan-mode ratio, permission denials, re-prompt loops (same error ≥3×), tests run before commit, skill invokes, context resets, tokens; (2) read the repo's ascent report via MCP so the reflection is grounded in the repo's actual gaps; (3) **interview** with single-keystroke questions — role, what they use AI for, where it wastes their time, what "productive" means to them; (4) write `profile.md` (habits observed, self-stated goals, archetype hints, boundaries) and show it — the developer edits it. |
| `retro` | `Stop` hook (opt-in) or manual | one-screen retrospective of the session just finished: what took the most turns, where the model was re-corrected, whether tests/lint ran, which skill would have shortened it. Zero questions unless something is genuinely ambiguous. Appends a line to `journal.jsonl`. |
| `weekly` | manual / cron | trend over the journal: what moved since last week, one **move** to try (see catalogue), one habit that worked (protect it). |
| `moves` | any time | recommendations ranked by *estimated time saved for this developer*: install skill X from the registry (with the fleet's invokes/outcomes from `catalog.json` as evidence — UC2), adopt habit Y, change setting Z (hooks, permission allowlist, model/effort defaults), seed CLAUDE.md for repo R because the journal shows the same commands re-explained (a UC1 practice — the developer becomes its champion; `moves` can open that PR via the SaaS if they choose). |
| `share` | explicit | pushes an *aggregate* (counts, chosen moves, accepted/declined) to the developer's personal workspace and — only if they choose — `invoke` events to the org (UC2 Phase A). Content never travels. |

**Handling variability.** No archetype is assigned from data; the interview + `profile.md` are the
contract, and archetype is a *hint* the developer confirms (explorer / director / verifier;
role: backend / frontend / data / lead). Each move carries `why (evidence from your journal)`,
`expected saving`, `try for: N sessions`, and is closed with `kept | dropped (reason)` — the same
decline memory the passport uses (`DeclinedByChoice`), so nothing is re-asked.

**Move catalogue (seed; grows through Skill Reflection lane 2 and org PRs to `skills/mentor/`).**
Session shape: plan-mode for multi-file work; smaller asks; end-of-session commit discipline.
Verification: tests-before-commit, `/code-review` on the diff, lint in a hook. Context: CLAUDE.md
sections that would have cut re-explanation; context-map awareness. Tooling: skills from the registry
(matched by the repo's dimension gaps and the developer's task mix); MCP servers the org publishes
in `.ai/manifest.yaml`; permission allowlists for the commands the journal shows re-approved. Cost:
model/effort defaults vs task shape (Tiger Lens-C logic at the individual scale).

### The SaaS side (opt-in lens, minimal)
- Personal workspace gains a **Mentor** panel: profile summary, moves accepted/declined, trend —
  from what `share` pushed and nothing else. Caps follow `personal.ts` limits.
- Org side sees only what UC2 already sees: `invoke` counts by repo. Per-person aggregates never leave
  the personal workspace unless a future, explicit "team retro" feature is designed with the champion
  floors.
- Developers without any ascent account still get the full local loop; the account only adds the
  cloud grounding (MCP) and the lens.

### Why not a scan
A per-developer scan from git alone (AI trailer share, repos touched) is what the Contributors tab
already gives under anti-surveillance floors, and it cannot answer the UC3 question ("is this person
getting value from the tools, and what would help"). It would also frame the developer as a subject.
Keep git-side signals as *inputs the developer can pull into their own reflection*, not as a score of
them.

### Sequencing
1. `mentor init` + `intake` + `moves` in the distributable (no server work) — proves the reflection loop.
2. `retro` hook + `weekly` — the habit engine. Seed `skills/mentor/` into registries (UC2 Phase A).
3. `share` → personal Mentor panel; `invoke` events into UC2 Phase A.
4. Tiger certifies the mentor's LLM surface (`engine/_expected/mentor.md`: grounding = journal +
   repo report via MCP + registry catalog; the senior bar = a good staff-engineer mentor).

---

## How `/ship-loop` and `/tiger` were reframed (v2.0)

- **`/ship-loop`**: the ship bar is now "each golden use case runs end-to-end and is honest". The 9
  engineering dimensions remain as the **hygiene scorecard** (they are the gate), and a **golden
  ledger** (UC1 / UC2 / UC3, each 🔴/🟡/🟢 with the journey it certifies) sits above it. Every
  backlog item is tagged `UC1|UC2|UC3|hyg`; milestones are picked per use case; dimension 9 "value &
  market" is folded into the ledger (the value case *is* the three use cases).
- **`/tiger`**: every engine note and finding carries `use_case`; the Character roster is re-bound so
  each use case has ≥2 judges (UC1: Sam, Mariam, Tomas · UC2: Priya, Marcus, Anika · UC3:
  Priyanka, Sam-as-IC, Elena) and Lens B's grounding audit asks the use-case questions (UC2: does the
  fleet's skill registry / memory reach the prompt? UC3: does the developer's own journal?). New call
  sites from UC2-E and UC3 are pre-registered as "expected kills".
