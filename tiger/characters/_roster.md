---
note_type: roster
session: 2026-06-20-tiger-l1
count: 10
source: reused from uat/characters/ (don't reinvent users — /tiger and /uat are siblings)
tags: [characters]
---

# Tiger roster — 10 Characters, each with an AI-surface angle

All 10 already exist in `uat/characters/*` — Tiger reuses them and re-scopes each to the **model output** of [[scan-assess]]. The "angle" is the dimension of the *LLM output* each judges hardest, chosen to span all three lenses. Must-pass Characters (the senior-quality floor for Lens C) are **bold**.

| # | Character | uat file | AI-surface angle | Lenses |
|---|---|---|---|---|
| 1 | **Sam — Staff Engineer** | `uat/characters/sam-staff-engineer.md` | grounding & hallucination — is every score re-traceable, is the roadmap repo-specific or generic | B (+C floor) |
| 2 | Arjun — ML Platform Lead | `uat/characters/arjun-ml-platform.md` | the model choice itself + structured-output discipline (he picks models for a living) | C, A |
| 3 | Victor — FinOps Director | `uat/characters/victor-finops-director.md` | cost per scan, the cost frontier, prompt-cache waste | C, A |
| 4 | Nadia — AppSec Lead | `uat/characters/nadia-appsec-lead.md` | prompt-injection from scanned repo files, secret/PII leakage in logs, data residency | A, B(trust) |
| 5 | **Tomas — Prospective Buyer** | `uat/characters/tomas-prospective-buyer.md` | first-impression credibility of the AI output | B |
| 6 | Elena — CTO Founder | `uat/characters/elena-cto-founder.md` | latency + cost + is-the-output-worth-the-wait | B, C |
| 7 | **Mariam — Fintech Audit** | `uat/characters/mariam-fintech-audit.md` | determinism & defensibility — same repo twice = same score? can I defend the number? | B(trust), A |
| 8 | Diane — Gov On-Prem | `uat/characters/diane-gov-onprem.md` | model privacy / on-prem / residency constraints on which model may even run | C, A |
| 9 | Mei — OSS Maintainer | `uat/characters/mei-oss-maintainer.md` | the free-tier engine (mock floor vs real model) + public badge trust | B |
| 10 | Tania — Scaleup Cost-Cut | `uat/characters/tania-scaleup-costcut.md` | "cut the LLM bill without losing the value" pressure | C |

**Coverage check:** Lens A → Nadia, Arjun, Victor, Mariam · Lens B → Sam, Tomas, Elena, Mariam, Mei · Lens C → Arjun, Victor, Diane, Tania, Elena. Skeptics (the senior-quality floor) → Sam, Mariam, Tomas. Every lens has ≥3 judges.
