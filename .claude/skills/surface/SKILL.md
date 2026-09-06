---
name: surface
description: "Turn ONE ai-registry ui-surfaces subject into a composed, interactive React/Tailwind/Motion showcase scene in Ascent's UI surfaces tab: resolve the subject through the bundle index, read its golden path, techniques and applications, write a brief, author the scene (one region per technique, deterministic fixtures, a reduced-motion path from props), register it in the surface catalog and body map, gate it (tsc, scoped vitest, the scene's jsdom test, LOC caps, a headless-Chromium screenshot into the vault), log the consult and the application leads, and add the subject's row to the surfaces doc. Refuses subjects outside ui-surfaces and input-and-editing subjects without --force; --refresh re-authors only when the subject's digest moved. Invoke with /surface <subject-slug> [--refresh] [--force]."
category: docs
memory: project
version: 1.0.0
tags: ui-surfaces, showcase, registry, knowledge, react, motion
argument-hint: "<subject-slug> [--refresh] [--force]"
model: fable
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Surface - one registry subject, one living scene

The registry's `ui-surfaces` subjects describe how a surface should behave; Ascent's
**UI surfaces** tab (`?tab=surfaces`, last in Shared) shows each one as a composed,
interactive scene: a technique rail on the left, the live scene in the middle, a
mechanism drawer for the selected technique. This skill is the procedure that turns a
subject into that scene. The session is the engine - no app LLM call, no server route,
no generation: you read the standard, you write the code, the gates say whether it is
real, and the logs tell the registry the subject was reached for.

Say the rule out loud once per run: **a bundle states the standard; the repo may
deviate, but a deviation is recorded, never silent.** Applications in the registry are
prose about OTHER repositories. They carry mechanisms and numbers you may reuse; they
carry nothing you may cite as Ascent's.

Sub-resources: `reference/contract.md` (the wire-level contract, verbatim from the spark
brief; names in it are final) and `reference/scene-template.md` (the folder skeleton).
This skill is project-owned (not in `.ai/manifest.yaml` `skills:`), so it is a real
directory, not a link.

---

## When to use

- A ui-surfaces subject has no scene yet (its gallery card says "Not yet showcased").
- A scene exists and the subject's digest in the registry index has moved (`--refresh`).
- A Director fans out subject runs to builder subagents; each builder runs this skill
  literally for one slug (see Coordination).

## When NOT to use

- The subject is not in `ui-surfaces` (a backend subject has no surface to show; use
  `/consult`).
- You want to change the tab itself (frame, rail, drawer, gallery, catalog types): that
  is feature work under `src/features/shared/surfaces/` shared files, not a subject run.
- You want a scene fed by org data. Scenes are fixtures by design (non-goal of the
  spark): a scene must render for an org that has indexed nothing.
- You want per-technique cards or hotspot annotations. One composed scene per subject.

---

## Coordination & safety

- **Builder mode.** When this skill runs inside a builder subagent under a Director:
  never `git add`, `git stash`, `git commit`, `git checkout`, or touch the index - the
  Director stages with pathspec. Touch only `src/features/shared/surfaces/<slug>/**`,
  the one record in `src/lib/org/surface-catalog.ts`, the one line in
  `src/features/shared/surfaces/surfaceBodies.ts`, and the one doc row - and if the
  Director pre-committed the record and the body line as stubs, edit them in place. In
  builder mode the log lines of step 6 are **returned in the report, not appended**:
  parallel appends to one JSONL file interleave.
- **Operator mode** (run directly in the terminal): you may append the log lines, and
  commit with pathspec (`git commit -- <paths>`), never `git add -A`.
- Files showing `M` in `git status` that are not in your write set belong to another
  session. Do not write to them; if the run needs one, say so and stop.
- Never write into the registry checkout (`../ai-registry`). Application files for
  Ascent are the registry's intake, not this skill's output.

---

## Step 0: Resolve the registry and the subject

```bash
# Registry root: $AI_REGISTRY_DIR wins, else registry.local from .ai/manifest.yaml
# (default ../ai-registry), resolved relative to the repo root.
REG="${AI_REGISTRY_DIR:-$(sed -n 's/^  local: *//p' .ai/manifest.yaml | head -1)}"
REG="${REG:-../ai-registry}"
test -f "$REG/knowledge/software-engineering/index.json" || { echo "no registry index at $REG"; exit 2; }
SLUG="$1"
node -e '
const [reg, slug] = process.argv.slice(1);
const idx = JSON.parse(require("fs").readFileSync(reg + "/knowledge/software-engineering/index.json", "utf8"));
const s = idx.subjects[slug];
if (!s) { console.error("unknown subject: " + slug); process.exit(2); }
console.log(JSON.stringify({ category: s.category, subcategory: s.subcategory, status: s.status,
  file: s.file, digest: s.digest,
  techniques: s.techniques.map(t => ({ slug: t.slug, use_when: t.use_when, laws: t.laws })),
  applications: (s.applications || []).map(a => ({ stack: a.stack, technique: a.technique, file: a.file })) }, null, 2));
' "$REG" "$SLUG"
```

Read the JSON and decide:

- **Unknown slug** -> refuse; list the 33 `ui-surfaces` slugs
  (`Object.keys(idx.subjects).filter(k => idx.subjects[k].category === "ui-surfaces")`).
- **`category !== "ui-surfaces"`** -> refuse. Not an error to work around: there is no
  surface to show.
- **`subcategory === "input-and-editing"`** -> refuse unless `--force`. It is listed in
  `.ai/manifest.yaml` `scope.out_of_scope_categories`
  (`software-engineering/ui-surfaces/input-and-editing`); with `--force` proceed and
  write `deviation` on the record's brief: "authored under --force; category is out of
  scope for this repo".
- **The slug is not in `SURFACE_SUBJECTS`** (`src/lib/org/surface-catalog.ts`) -> stop.
  `SURFACE_SUBJECTS` is the static mirror of the bundle's 33 subjects; a slug in the
  index but not in the mirror means the mirror is stale, which is tab work, not a
  subject run. Say so.
- **`--refresh`**: read `surfaceRecord(slug).authoredAgainst.digest` from the catalog.
  If it equals the index `digest`, **stop and say the scene is current** - a refresh
  with nothing changed is a no-op, not a rewrite. Otherwise continue and keep the old
  `brief.md` in memory: step 2 diffs against it.
- **No `--refresh` and the slug is already in `SURFACE_CATALOG`** -> stop and point at
  `--refresh`.

Every path from here uses `file` values from the index. Never build a path from a slug
(the tree has moved before; the index is what the registry promises).

## Step 1: Read

In this order, all of it, before writing a line of code:

1. **The golden path**: `$REG/<subjects[slug].file>`. Note the surface's shape, the
   order it introduces the techniques in (that becomes the rail order), and what it
   calls the surface's failure modes.
2. **Every technique file**: `$REG/<dirname of file>/techniques/<technique slug>.md`
   (the directory the golden path sits in; confirm with `ls`). For each, pick the ONE
   `use_when` entry the scene will embody and write it down verbatim - it goes in the
   brief and is what the drawer prose must make visible.
3. **Every application**: `$REG/<applications[].file>`. Read `react--*` first for the
   mechanism in this toolset; read the other stacks for mechanism ideas and the numbers
   (thresholds, budgets, window sizes) they state. Extract mechanisms and numbers; a
   citation of another repo's file is that repo's, and never becomes Ascent evidence.
4. **The laws** the techniques cite: `$REG/knowledge/software-engineering/_laws.md`,
   the named anchors only.
5. **The reference scene** `src/features/shared/surfaces/motion/` and
   `src/components/ui/BRAND.md`: the proven body shape and the brand kit you must use.

Then grep the repo for Ascent evidence per technique - `rg "<the mechanism's own
noun>" src` (a hook name, a CSS utility, a constant). Record the exact pattern you ran
and its result, hit or `0 hits`. "In Ascent" in the drawer is only ever a file you read.

## Step 2: Brief

Write `src/features/shared/surfaces/<slug>/brief.md` with the schema in
`reference/scene-template.md` ("brief.md"): subject, subcategory, digest, `verifiedOn`
(today, `YYYY-MM-DD`), golden path, the scene concept in three sentences, and per
technique: the `use_when` matched, the mechanism to show with React/Tailwind/Motion,
the region plan, the Ascent evidence with the grep named, the deviation.

The scene concept is the hard part and the reason this is one brief and not a list:
find ONE composed surface in which every technique of the subject is a natural region -
a fleet table for `table`, a scan feed for `feed`, a search-over-repositories for
`search`. A viewer should be able to use it as a product surface for a minute without
knowing it is a showcase; the rail is what reveals the techniques.

`--refresh`: diff the new read against the old brief section by section. Re-author only
the techniques whose `use_when`, mechanism or region changed; bump `digest` and
`verifiedOn`; leave unchanged regions' code alone and say in the report which sections
moved. A new technique in the index gets a new region; a removed one loses its region,
its `techniques.ts` entry and its `techniqueSlugs` entry in the same turn (the
bijection test fails otherwise).

## Step 3: Author the scene

Create the folder per `reference/scene-template.md`: `index.ts`, `Scene.tsx`,
`techniques.ts`, `fixtures.ts`, `brief.md`, `Scene.dom.test.tsx`, plus co-located
region files as the LOC cap demands. Rules (each one has failed a run before it was a
rule):

- **One composed scene.** Every technique is a region whose outermost element carries
  `data-technique="<slug>"` - one per slug, never nested. Selection (ring on the
  selected region, dimming of the rest) is the frame's job; the scene never styles it.
- **Fixtures are fiction, deterministic, and say so on screen.** A seeded generator, no
  `Math.random`, no `Date.now`. Data-display subjects (`subcategory ===
  "data-display"`) take the `volume` prop from `SURFACE_VOLUMES` (`50 | 5000 | 50000`)
  and render a window of it - the knob shows the technique surviving 50,000 rows, not
  50,000 mounted nodes. Other subcategories accept the prop and may ignore it with a
  comment. The scene renders a visible line: fixture rows, count, "nothing here is an
  Ascent org".
- **`reduced` comes from props.** Never a media query or `useReducedMotion()` inside a
  scene: the frame's simulate toggle must override the OS setting, and the jsdom test
  renders both paths. Under `reduced` every region still renders its content (a blank
  region is a failure, not a degradation) and loops start paused.
- **No always-on loop without a visible pause control** in the same region. If the
  technique is about a loop (a live dot, a poll cycle), the pause button is part of the
  mechanism and is what the drawer's prose points at.
- **Brand.** Only `@/components/ui` primitives (`Surface`, `Kicker`, `Stat`,
  `SectionHeading`, `HairlineGrid`, `Field`/`TextInput`, `chipButtonClass`, `fmtDelta`)
  and `type-*` classes; colors from `@/lib/ui`; `bg-accent` is the one accent. No raw
  `text-xs`, no `text-[10px]`, no hand-picked hex. Read `BRAND.md` once per run.
- **framer-motion inside the scene only.** The chunk is per subject through the body
  map's dynamic import; a `framer-motion` import in any shared frame file pulls it into
  the tab chunk for every subject.
- **LOC: every file in the folder is at or under 200 lines**, tests included. Extract a
  region to `Scene<Region>.tsx` (with `"use client"` only if it holds hooks or
  handlers) the moment the orchestrator nears the cap; never a per-technique card
  layout as the escape.
- **`techniques.ts` carries four honest fields per technique**: `mechanism` (3-6
  sentences in your words), `source` (a real 10-25 line excerpt of this scene's final
  code, grep-able in the folder), `inAscent` (a file you read plus one sentence, or
  `null`), `deviation` (or `null`). Write `source` last, after the code is final.
- Nothing in the scene reads the URL, the router, the org, or the registry.

## Step 4: Register

1. `src/lib/org/surface-catalog.ts`: add (or, in builder mode with a stub, fill) the
   `SurfaceRecord` in `SURFACE_CATALOG`: `slug`, `subcategory`, `title`, `summary` (one
   sentence, the scene concept), `authoredAgainst: { digest, verifiedOn }` from the
   brief, `techniqueSlugs` in rail order. Keep registry order among records.
2. `src/features/shared/surfaces/surfaceBodies.ts`: add the `import("./<slug>")` entry
   to `SURFACE_BODIES`: `<slug>: () => import("./<slug>").then((m) => m.body)` - the
   body is a NAMED export `body` from `<slug>/index.ts`, exactly like `motion`.
3. Confirm the slug is in `SURFACE_SUBJECTS` (step 0 did; the bijection test does again).

## Step 5: Gate

Run in this order; a red gate stops the run, it does not get narrated around.

```bash
npx tsc --noEmit
npx vitest run src/features/shared/surfaces src/lib/org
```

The vitest scope holds the bijection test (`surfaceCatalog.test.ts`: every record has a
body and vice versa, unique slugs, every record slug in `SURFACE_SUBJECTS`, every
`techniqueSlugs` entry matches the body's `techniques`) and your `Scene.dom.test.tsx`
(mounts, every declared region present once, the reduced path renders, the fiction
notice shows).

LOC caps, from `AGENTS.md` (PowerShell; `-LiteralPath` so bracket dirs are not globbed):

```powershell
Get-ChildItem -Recurse -File src/features | Where-Object { $_.Extension -in '.ts','.tsx' } |
  ForEach-Object { [pscustomobject]@{ LOC=(Get-Content -LiteralPath $_.FullName).Count; Path=$_.FullName } } |
  Where-Object { $_.LOC -gt 200 } | Sort-Object LOC -Descending
```

Expected output: nothing. (The 300-LOC `.tsx` check for `src/**` is irrelevant here
unless you touched a file outside `src/features/`, which you should not have.)

### Observation - the scene in a real browser

A client-rendered Suspense boundary is invisible to `curl`; a grep of the HTML proves
nothing about the scene (2026-09-05 lesson: a jsdom-green surface shipped with a
cascade bug only a screenshot showed). Use headless Chromium.

1. **Is a dev server reachable?** `npm run doctor` prints the env matrix; then
   `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` (a `200`/`307`
   means a server; connection refused means none). If none, either start one
   (`npm run dev`; in local mode the memory-known flags are `ASCENT_SELF_HOSTED=1
   ASCENT_LOCAL_ORG=<org> ASCENT_AUTOPILOT=1`, and `node scripts/seed-fleet.mjs <org>`
   populates an org against a running server) or **stop here and report "not
   observed"**. Never mark a scene observed without a screenshot file on disk.
2. **Pick the org slug**: the one you seeded, or the one `ASCENT_LOCAL_ORG` names.
3. **Resolve the vault**: `vault:` in `.claude/spark/config.md` is a list of candidate
   paths; the first that exists on this machine wins; if none exists, use
   `<repo>/.spark/`. The screenshot goes to `<vault>/Spark/surfaces/<slug>.png`
   (create the directory).
4. **Run from the repo root** (Git Bash; `@playwright/test` is a dev dependency and
   its Chromium is installed for the e2e suite):

```bash
ORG=<org> SLUG=<slug> OUT="<vault>/Spark/surfaces/<slug>.png" node --input-type=module - <<'EOF'
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
const { ORG, SLUG, OUT, BASE = "http://localhost:3000" } = process.env;
const url = `${BASE}/org/${ORG}?tab=surfaces&subject=${SLUG}`;
mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
const regions = page.locator("[data-technique]");
await regions.first().waitFor({ state: "visible", timeout: 30000 });
const count = await regions.count();
const rail = page.locator("[aria-current]");
const railCount = await rail.count();
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(JSON.stringify({ url, regions: count, railCurrent: railCount, errors, out: OUT }));
if (count === 0 || errors.length) process.exit(1);
EOF
```

Assert by hand against the JSON: `regions` equals the number of techniques in
`techniques.ts`; `railCurrent` is 1 once a technique is selected (append
`&technique=<first slug>` to the URL for that check, and once more with the drawer
open for a second screenshot if the drawer's layout is part of what you changed);
`errors` is empty. Open the PNG (`Read` renders images) and look: is every region
present, is the fiction line visible, does the brand hold (one accent, mono numbers,
hairline surfaces). A screenshot you did not look at is not an observation.

## Step 6: Log

Two files at the repo root, one line each, JSON on one line, `ts` in ISO-8601 UTC:

`.ai/consults.jsonl` - one line per run:

```json
{"ts":"2026-09-06T12:00:00Z","bundle":"software-engineering","subjects":["<slug>"],"techniques":["<slug-1>","<slug-2>"],"deviations":<n>}
```

`techniques` lists every technique read (all of them, since the scene embodies all);
`deviations` counts the non-null `deviation` fields in `techniques.ts`.

`.ai/registry-leads.jsonl` - one line per technique whose `inAscent` is non-null:

```json
{"ts":"2026-09-06T12:00:00Z","bundle":"software-engineering","nearest":"<subject-slug>","kind":"application","claim":"<the mechanism as a transferable rule, one sentence>","because":"<the Ascent file and what it does that instantiates the rule; the scene region that shows it>","confidence":"medium","from":"surface@1.0.0"}
```

`confidence`: `high` when the Ascent file implements the mechanism clause for clause,
`medium` when it holds the mechanism with a local twist, `low` when it is adjacent
evidence. A technique with `inAscent: null` gets no lead line: an absence is not an
application.

**Builder mode: return the lines in the report; do not append.** Operator mode: append
with `printf '%s\n' '<line>' >> .ai/consults.jsonl` (no trailing-newline surprises:
check `tail -c1` of the file first).

## Step 7: Docs

The doc-sync Stop hook maps `src/features/shared/surfaces/**` to
`docs/features/org-knowledge/surfaces.md`. In the same turn add the subject's row to
its surfaces table: subject (linked to the gallery URL), subcategory, technique count,
`authoredAgainst` digest and date, observed (`yes` with the screenshot path, or `no`).
If the doc carries a "Known gap" naming this subject as not yet showcased, delete it.
Do not touch `knowledge-base.md` or `org-intelligence.md` for a subject run; those
changed once, with the tab.

---

## Guardrails

- **BRAND is not a preference.** `@/components/ui` primitives, `type-*` classes, colors
  from `@/lib/ui`. A raw `bg-violet-500/15` or a `text-[10px]` is a tell that the scene
  was invented in isolation; the gallery puts it beside fourteen siblings and it shows.
- **LOC: 200 per file under `src/features/**`**, tests included; the remedy is
  co-located extraction of a region, never a redesign and never per-technique cards.
- **No media queries in scenes.** `reduced` is a prop; `MotionConfig reducedMotion="user"`
  lives in the frame. A scene that reads `prefers-reduced-motion` itself breaks the
  simulate toggle and the jsdom test cannot exercise it.
- **Honest absence.** `inAscent` is a file you opened, or `null`. `deviation` is
  something the scene or the repo actually does differently, or `null`. A drawer that
  claims evidence it does not have teaches the reader to distrust the whole tab.
- **Fixtures are fiction and say so in the scene**, on screen, every time. A viewer
  who takes a showcase's numbers for their org's numbers has been lied to by a
  paragraph you did not write.
- **Applications are other repos.** Their mechanisms and numbers transfer; their file
  paths and their claims do not. If a react application names a hook, you grep Ascent
  for the equivalent; you do not write the other repo's path into `inAscent`.
- **Do not edit a guard test to pass.** `surfaceCatalog.test.ts`, `orgTabs.test.ts`
  and the LOC checks are the contract. A red guard is a finding to report with
  `file:line`, not a line to widen.
- **Never mark observed without the PNG on disk and looked at.** "Tests green" and
  "observed" are different claims; the report keeps them apart.

## Signals to abort

- The subject's `category` is not `ui-surfaces`, or the slug is unknown: abort at step 0.
- `input-and-editing` without `--force`: abort with the manifest line that excludes it.
- `--refresh` and the digest is unchanged: abort with "current against <digest>".
- The slug is missing from `SURFACE_SUBJECTS`: abort; the mirror is tab work.
- The reference scene `motion/` is missing or the body map's `motion` entry has a shape
  you cannot match: abort; WP1 has not landed, and a scene authored blind will not mount.
- A shared file (`SurfaceFrame.tsx`, `surfaceBody.ts`, the test) needs a change for
  your scene to work: abort and report the seam. A subject run does not move the frame.

---

## Exit checklist

- [ ] Step 0 resolved the subject through `index.json`; category, subcategory and
      `SURFACE_SUBJECTS` membership checked; `--refresh`/`--force` semantics honored.
- [ ] Golden path, every technique, every application read; per-technique `use_when`
      matched verbatim in `brief.md`; Ascent evidence greps named with their result.
- [ ] `brief.md` written (or diffed and re-authored under `--refresh`) with today's
      `verifiedOn` and the index digest.
- [ ] One composed scene; every technique has exactly one `data-technique` region;
      fixtures deterministic, sized by `volume` where data-display, declared fiction on
      screen; `reduced` from props; loops have a pause control.
- [ ] `techniques.ts`: `mechanism` 3-6 sentences, `source` a real excerpt, `inAscent`
      a read file or `null`, `deviation` real or `null`.
- [ ] Catalog record and body-map entry added or filled; rail order matches
      `techniqueSlugs`.
- [ ] `npx tsc --noEmit` clean; `npx vitest run src/features/shared/surfaces
      src/lib/org` green; the 200-LOC check prints nothing.
- [ ] Observed: screenshot at `<vault>/Spark/surfaces/<slug>.png`, `regions` count
      matches, no page errors, PNG opened and looked at - or the report says
      "not observed: no dev server" in those words.
- [ ] Consult line and lead lines written (operator) or returned (builder).
- [ ] The subject's row added to `docs/features/org-knowledge/surfaces.md`; a matching
      "Known gap" deleted.
- [ ] Builder mode: no `git add`/`stash`/`commit`/`checkout`; nothing touched outside
      the write set.

End with the three-line report the Director (or the operator) quotes: the scene
concept in one sentence, the gate line (tsc / vitest / LOC / observed-or-not), and the
log lines.

---

## Project overlay

`memory: project` here means the skill reads per-repo state; this section names where.
The skill is project-owned by Ascent, so the values below are Ascent's; another repo
adopting the procedure would put its own in the same slots.

- **Registry**: `.ai/manifest.yaml` `registry.local` (Ascent: `../ai-registry`);
  `$AI_REGISTRY_DIR` overrides. Bundle: `software-engineering` (the only domain in
  `knowledge.domains`). Out-of-scope subcategories: `scope.out_of_scope_categories` in
  the same file (Ascent: `software-engineering/ui-surfaces/input-and-editing`).
- **Vault**: `vault:` in `.claude/spark/config.md`, first existing candidate, else
  `<repo>/.spark/`. Screenshots land in `<vault>/Spark/surfaces/<slug>.png`. Note for
  this machine (Fox): the config's candidate is another device's path; the vault that
  exists here is `C:/Users/mkdol/Documents/Obsidian/ascent`. Until `vault:` lists it,
  the rule resolves to `<repo>/.spark/`; say which one you wrote to.
- **Dev server and org**: `npm run doctor` for the env matrix; `http://localhost:3000`
  is the default base (`BASE` env overrides in the observation script); an org comes
  from `node scripts/seed-fleet.mjs <org>` against the running server, or from
  `ASCENT_LOCAL_ORG` in local mode (Fox: `dolla`, see the project memory).
- **Doc**: `docs/features/org-knowledge/surfaces.md`, mapped from
  `src/features/shared/surfaces/**` in `scripts/docs/feature-doc-map.json`; the Stop
  hook `node scripts/docs/check-doc-sync.mjs` enforces the same-turn row.
- **Logs**: `.ai/consults.jsonl` and `.ai/registry-leads.jsonl` at the repo root, the
  same files `/consult` and `/perfect` write.
- **Gates and caps**: from `AGENTS.md` and `.claude/spark/config.md`: tsc, scoped
  vitest, 200 LOC under `src/features/**`, doc-sync hook. Nothing skill-local.
- **Lessons**: `LESSONS.md` beside this file, created on the first lesson only, headed
  `## <version> - <YYYY-MM-DD> - ascent`.
