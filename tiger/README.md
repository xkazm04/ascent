# tiger/ — the Tiger vault (open me in Obsidian)

This folder is an **Obsidian vault** and the per-app overlay for the `/tiger` skill (`.claude/skills/tiger.md`). Tiger certifies the **LLM call sites** of this app — the highest-value, highest-cost, highest-variance part — across three lenses, and stores everything here so each run extends the last.

**Start at [[MOC]]** (`MOC.md`) — the home note linking everything.

## What's here
- `engine/` — one note per LLM call site (the memorized map). This app has exactly one: [[scan-assess]].
- `lenses/` — the three rubrics: engine-quality (A), business-value (B), model-optimization (C).
- `models.md` — the model × thinking benchmark matrix + price snapshot (Lens C).
- `characters/_roster.md` — the 10 Characters (reused from `uat/characters/`) + their AI-surface angles.
- `sessions/` — one dated note per run; the session memory + deltas.
- `backlog.md` — the living, impact-ranked backlog (the deliverable).

## Run it
- `/tiger init` — (re)map the LLM surface + scaffold this vault.
- `/tiger run` — L1 sweep across all 3 lenses (mass-parallel Characters) → a session note + backlog + predicted model frontier. `--l2` adds live model calls.
- `/tiger benchmark` — Lens C live: run the model × thinking matrix, plot the real cost↔quality frontier.
- `/tiger recall` — read the memory; report the engine's trajectory.

This vault is committed (it's the memory). Raw benchmark transcripts are gitignored; scored summaries are kept.
