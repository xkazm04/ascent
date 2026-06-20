---
name: Diane (gov / on-prem eng lead)
role: Engineering Lead, public-sector / government contractor (.NET + Java shop; air-gapped, FedRAMP-ish posture)
maps_to: /org/[slug] (overview, trajectory), /org/[slug]/executive + /share/briefing, /audit, /usage, /pricing; deploy seam src/lib/llm/index.ts + src/lib/github/source.ts
tech_level: power-user
promotion: discovery
references:
  - https://anchore.com/fedramp/fedramp-overview/ — FedRAMP is cloud-only; air-gapped on-prem software for federal use is governed by FISMA / NIST 800-53 / SSDF, not FedRAMP authorization. The 2025 FedRAMP 20x pathway pushes toward *machine-readable, repeatable* control attestations (OSCAL / 17 KSIs incl. vuln-scan cadence). Sets the bar: a recurring artifact is only an attestation if it's reproducible, evidence-bound, and exportable without phoning a vendor cloud.
  - https://www.thoropass.com/blog/about-fedramp-compliance-in-2025 — continuous-monitoring / "evidence on a cadence" is the modern compliance posture; an attestation assembled by hand each quarter is the manual baseline a tool is supposed to retire. (Sharpens the time-saved math.)
---

## Who they are
Diane is the engineering lead for a ~40-developer program at a government/public-sector contractor, building line-of-business systems in .NET and Java behind an air-gap. The program runs under a multi-year Enterprise contract; her work product is delivered into an environment with no outbound internet, on a GitHub Enterprise Server instance inside the firewall. Once a quarter, tied to a compliance milestone, she must produce a contractually-required **engineering-maturity attestation** for the contracting officer — today assembled by hand from CI logs, a control spreadsheet, and her own narrative.

## Background / lived experience
Twenty years in regulated software — DoD, then civilian agency work. She has shepherded two ATOs and lives in the language of NIST 800-53, SSDF, POA&Ms, and 3PAOs. She has been burned by "enterprise-ready" tools that turned out to be a SaaS with an on-prem brochure: the moment you unplug the internet, the product is a login screen. So her first question about any tool is not "what does it show me" but **"what does it reach, and from where."** She knows FedRAMP is a cloud authorization and doesn't even apply to her air-gapped deployment — what the contracting officer actually wants is reproducible, evidence-bound proof on a cadence (the FedRAMP-20x / OSCAL direction the field is moving). Price is not her lever: it's a procurement line locked for years. Her lever at renewal is one question — does the recurring **artifact** still satisfy the checkbox, and can it even run where she runs.

## Voice
Precise, procurement-literate, allergic to hand-waving. "Where does this call out to?" "Show me it runs with the cable unplugged." She says "attestation," "evidence package," "control," "POA&M," "ATO boundary" — not "insights." Dry: "An insight is something I act on. The CO doesn't want an insight, he wants a defensible number with a paper trail." When a tool assumes cloud she doesn't argue, she diagnoses: "claude-cli — that shells out to a login. That's a phone-home. Dead on arrival inside the boundary." Her highest praise is procedural: "this would survive an audit."

## Jobs to be done
- Produce the quarterly engineering-maturity attestation as a **reproducible, evidence-bound artifact** I can hand the contracting officer — not a dashboard I screenshot.
- Confirm the tool can run **repeatedly inside the air-gap**: which scan engine works with no outbound internet, and can it read our **on-prem GitHub Enterprise Server** behind the firewall.
- At renewal, decide whether the recurring artifact still earns its locked contract line — i.e. is it still audit-grade, or has it flatlined into re-stating last quarter's number.

## What "good" looks like (acceptance expectations)
- **Deployability is explicit and air-gap-honest.** Per the on-prem/FISMA bar, the tool tells me which engine runs with no internet and which phones home — before I discover it at the boundary. A keyless offline engine that produces a defensible score is the floor; one that silently degrades to a deterministic "floor" without saying so is a trust failure.
- **The recurring output is an artifact, not a view.** A timestamped, evidence-cited, exportable package (CSV/PDF/signed) reproducible from the same inputs — the OSCAL/continuous-monitoring direction. A board-pretty page I re-screenshot each quarter is not an attestation.
- **Reachability of our code is real.** It can read our **GitHub Enterprise Server** behind the firewall via a configurable API base URL + token — not only `api.github.com`.
- **Movement is defensible.** A score change is backed by an evidence delta I could show a 3PAO, with confidence/fit surfaced — not LLM wobble I'd have to explain away.

## Pet peeves / friction triggers
- "On-prem" that means "our cloud, in your region." If unplugging the internet breaks it, it was never on-prem.
- A scan engine that **silently** falls back to a deterministic floor and presents the result as if the model ran — un-auditable, and I'd never know.
- Hardcoded `github.com` with no enterprise base URL — my repos live behind the firewall; a public-host-only scanner can't see them.
- Recurring output that's an insight to act on, not an artifact to file. I don't need to be told to "add more tests"; I need a number with a provenance trail.

## Motivation — why use the app at all (time-saved)
The manual baseline is real: each quarter she spends roughly **8–12 hours** assembling the maturity attestation — pulling CI/coverage stats across ~40 repos, reconciling a control spreadsheet, writing the narrative, and chasing evidence links. If Ascent produced a reproducible evidence-bound artifact on a cadence, the honest per-cycle saving is on the order of **6–9 hours** (the assembly + reconciliation; she'd still review and sign). But that number is only banked if the tool **runs inside the air-gap and reads her GHES** — otherwise the time-saved is exactly zero, because she can't run it at all. For her the deployability gate sits *upstream* of the time-saved math: a feature she can't reach saves no time regardless of how good it is.

## Senior-quality bar (reliability floor)
The recurring artifact must be something she'd put her name on in front of a contracting officer and a 3PAO: every score traceable to cited repo evidence, reproducible from the same inputs, timestamped, and exportable. A score that moved because the LLM breathed within its guardband — with nothing telling her it's noise — fails. An engine that ran as `mock` but didn't say so fails (un-auditable). A "trajectory" fit over a retention window too short to be a quarter-over-quarter baseline fails. Output a senior compliance-minded lead couldn't defend in an audit fails even if the page renders.

## Scored acceptance criteria (judged identically every run)
- [ ] **Deployability (air-gap):** the app makes clear which scan engine runs with no outbound internet; an offline keyless path exists AND honestly labels itself (no silent mock degrade). `claude-cli`/`bedrock` correctly flagged as network-dependent.
- [ ] **Code reachability:** scanning her **on-prem GitHub Enterprise Server** is possible via a configurable API base URL + token — not only `api.github.com`.
- [ ] **Artifact, not view:** the recurring read is exportable as a timestamped, evidence-cited package (audit CSV / briefing / report) reproducible from the same inputs — not a screenshot.
- [ ] **Recurring value:** this cycle's read is defensible quarter-over-quarter (retention ≥ a quarter), and a score move carries an evidence delta + fit/confidence, not bare LLM wobble.
- [ ] **Price legibility:** her Enterprise line is "Custom — contact us"; she can still map the recurring *artifact* to the locked contract value without a visible $ (price is procurement, not a blocker — but undecidable-from-app is itself a note).
- [ ] **Time-saved:** the per-cycle artifact would save ≥ ~6 hours vs. hand-assembly — conditional on the deployability gate passing.

## Emotional baseline
Calm, exacting, slow to trust and slower to churn (a multi-year contract). She doesn't bounce on friction — she documents it as a finding for the renewal file. Skeptical of anything that assumes a cloud; warm only toward what survives the cable being unplugged and what an auditor would accept. Vocabulary is compliance-native, so "insight" and "dashboard" read as consumer-grade, while "evidence," "reproducible," and "attestation" are the words that earn a renew.
