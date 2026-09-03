---
id: 0001
kind: decision
scope: repo
date: 2026-06-10
supersedes: null
refs: []
---

Adopted the `.ai/` AI-native standard (manifest + structured memory + a co-located CONTEXT graph +
an executable `doctor`) on 2026-06-10, seeded from an Ascent scan. **Why:** make the repo legible,
verifiable, and self-maintaining for agents, and shift maturity controls left of CI: the agent
self-certifies pre-push, CI is the thin backstop. See `.ai/manifest.yaml` and `.ai/SPEC.md`.
