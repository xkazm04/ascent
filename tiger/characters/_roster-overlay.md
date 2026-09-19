# ascent - `characters/_roster.md` overlay (use_case binding + four new judges)

Apply to `tiger/characters/_roster.md` in the ascent repo. The existing 10 rows, angles and lens
coverage stay as they are; this adds a `use_case` column and four rows so every job has >= 2
judges (the v2.0 rule). The four new Characters already exist in `uat/characters/` - link, do
not re-author.

## Frontmatter change

```
count: 14
source: reused from uat/characters/ (don't reinvent users - /tiger and /uat are siblings); use_case binding added 2026-08-22 per docs/GOLDEN-USE-CASES.md
```

## `use_case` column for the existing rows (proposed from each Character's angle - confirm on merge)

| # | Character | use_case |
|---|---|---|
| 1 | **Sam - Staff Engineer** | UC1 (must-pass); also UC3 as Sam-as-IC (the IC hat: "is this advice for ME, not for the repo") |
| 2 | Arjun - ML Platform Lead | cross (Lens C / A - the model choice and structured-output discipline serve every job) |
| 3 | Victor - FinOps Director | cross (Lens C cost frontier) |
| 4 | Nadia - AppSec Lead | cross (Lens A); ALSO the enforcer of the UC3 privacy hard check (transcript content in prompts / logs / telemetry) |
| 5 | **Tomas - Prospective Buyer** | UC1 (must-pass) |
| 6 | Elena - CTO Founder | UC3 (founder-as-developer: latency + cost + is the reflection worth the wait); UC1 secondary |
| 7 | **Mariam - Fintech Audit** | UC1 (must-pass) |
| 8 | Diane - Gov On-Prem | cross (Lens C model privacy / on-prem - which model may even run) |
| 9 | Mei - OSS Maintainer | UC1 (free-tier engine: mock floor vs real model; public badge trust) |
| 10 | Tania - Scaleup Cost-Cut | cross (Lens C "cut the LLM bill without losing the value") |

## New rows (11-14)

| # | Character | uat file | AI-surface angle | Lenses | use_case |
|---|---|---|---|---|---|
| 11 | **Priya - Platform Lead** | `uat/characters/priya-platform-lead.md` | does the fleet truth reach the prompt - the skill registry, adoption / drift state, Org Memory; is a tailored skill honest about what it could not ground | B (+C floor for UC2) | UC2 (must-pass) |
| 12 | Marcus - Engineering Manager | `uat/characters/marcus-engineering-manager.md` | adoption honesty and outcomes - does the output claim fleet-wide facts the telemetry cannot back (honest zeros), is the proposal something a CODEOWNER would merge | B (trust) | UC2 |
| 13 | Anika - JVM Platform | `uat/characters/anika-jvm-platform.md` | stack-fit of the tailored output - does it use THIS repo's real (JVM / Gradle / Maven) commands and paths, or node-shaped defaults; frontmatter preserved by construction | B, A | UC2 |
| 14 | **Priyanka - Indie / Solo IC** | `uat/characters/priyanka-indie-solo.md` | privacy first ("nothing leaves my machine I did not choose") and "is this advice senior-mentor grade for MY work, not generic hygiene"; no account, offline path | B (trust, senior-quality), A (privacy) | UC3 (must-pass) |

## Coverage check (after merge)

- Lens A -> Nadia, Arjun, Victor, Mariam, Anika, Priyanka . Lens B -> Sam, Tomas, Elena, Mariam,
  Mei, Priya, Marcus, Anika, Priyanka . Lens C -> Arjun, Victor, Diane, Tania, Elena, Priya.
- UC1 -> Sam, Mariam, Tomas (+ Mei) . UC2 -> Priya, Marcus, Anika . UC3 -> Priyanka, Sam-as-IC,
  Elena (+ Nadia for the privacy hard check). Every job >= 2 judges; every lens >= 3.
- Must-pass panel (the senior-quality floor for Lens C): UC1 Sam, Mariam, Tomas; UC2 Priya;
  UC3 Priyanka.
