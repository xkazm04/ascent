---
name: Arjun (data/ML platform lead)
role: Head of Data/ML Platform (owns the shared ML infra + ~40 training/experiment repos for a 50-eng org)
maps_to: /org/[slug] (overview · Trajectory · movers), /org/[slug]/executive, /trends, /usage, /pricing, schedule/alerts/rescan
tech_level: power-user
promotion: discovery
references:
  - https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/mlops-maturity-model — Azure MLOps maturity model: maturity is model + data + CODE across 5 levels; notebooks-and-quick-scripts is the EARLY stage, and "CI/CD" means automated *retraining/validation/deployment* of pipelines, not unit-test gates. Sets the bar: a maturity read for ML must measure the ML lifecycle, not just repo hygiene.
  - https://mlops.community/blog/mlops-maturity-assessment — community MLOps assessment: experiment churn (many notebooks, fast iteration) is healthy at the assessed stage, not a defect — a tool that reads churn as immaturity is mis-calibrated for ML. (training-data corroborated.)
---

## Who they are
Arjun runs the data/ML platform group at a ~50-engineer company — about a dozen of those are ML/research engineers shipping training jobs, evals, and feature pipelines. He owns ~40 repos: mostly Python, Jupyter-notebook-heavy, with model-training code, experiment sweeps, and feature-store glue. He's on the **Team** plan, scans the fleet **monthly**, and someone upstream just asked him to defend the line item. He is technical enough to read the rubric and call BS on it.

## Background / lived experience
Came up as an ML engineer, then SRE-for-ML, now platform lead. He's been burned by "engineering productivity" tools built for web/services teams that score ML repos as garbage: a DORA dashboard that flagged his training repos as "low deploy frequency" (they don't deploy, they train), a code-coverage gate that wanted unit tests on a notebook that's 80% a plotting cell. He knows the real ML maturity questions — is training reproducible, is data versioned, are evals gating model promotion, is there a model registry — and he knows most generic tools don't ask any of them. His standing baseline is honest: there *isn't* a clean manual ML-maturity number; it's genuinely hard to measure, which is exactly why a credible automated read would be worth real money to him. He answers to a VP who signs the renewal and a research org that will roll their eyes if the tool calls their work "L1 Manual" for lacking a CODEOWNERS file.

## Voice
Precise, a little weary, quick to spot a stack mismatch. "Does this thing even know what a notebook is?" "Missing unit tests isn't a finding on a training repo — that's the stack, not the maturity." "Show me what *changed* since last month, not the same number in a new font." "Is that 3-point bump my team's work or your LLM breathing?" He respects a tool that admits what it can't see; he's contemptuous of one that confidently mis-scores. Highest compliment: "okay, it didn't penalize me for the wrong things." Worst verdict: "this is a JS-shop rubric wearing an ML costume."

## Jobs to be done
- Once a month, get a *trustworthy* read of whether my ~40 ML repos are getting more mature — and trust that the month-over-month *move* is real, not re-scan noise or experiment churn misread as change.
- Know the rubric actually FITS notebook/ML repos before I quote a number to my VP — that it isn't docking me for unit tests and conventional commits that don't apply to research code.
- Map the recurring cost (40 repos × monthly = 40 credits/mo against my 500) to recurring value, and see enough price to defend the renewal.

## What "good" looks like (acceptance expectations)
- The maturity read **fits the ML stack**: notebooks are recognized as code, and missing web-dev guardrails (unit tests, CI gates, conventional commits) are framed as *not applicable* for a research repo, not as gaps that drag it to L1. Per the Azure/MLOps maturity models, experiment churn is the healthy early-stage signal, not immaturity.
- The **archetype lens adapts** — an ML/notebook repo is judged against an ML-appropriate weighting, not the same 9-dim web rubric.
- Each monthly cycle says something **new + actionable**, and a score move is **labeled real vs. noise** (R²/flat-floor surfaced where the move is shown), so he isn't quoting LLM wobble as progress.
- **Price legible enough** to defend at Team: he can see credits burned vs. 500 allotment and the 365-day window — even though the subscription $ isn't in the app.

## Pet peeves / friction triggers
- A "missing tests / add CI / use conventional commits" roadmap on a training repo — generic web-shop advice that ignores the stack. Instant credibility loss.
- Notebooks counted as *nothing* (not source, not docs) so the repo looks empty or untested.
- A month-over-month trend that's actually re-scan jitter, presented as if his team moved the needle.
- A flat trajectory on stable infra repos that says "nothing new" every month — paying for a re-render.
- Being told to "contact us" or shown only "prepaid credits" when he's trying to justify spend to finance.

## Motivation — why use the app at all (time-saved)
Doing this read by hand is brutal precisely because ML maturity has no clean metric: he'd spend roughly **half a day a month** (~4 hrs) eyeballing 40 repos for repro/eval/versioning signals and assembling a defensible story — and it'd still be subjective. If Ascent gave a trustworthy, re-pullable fleet read that actually fit ML, the recurring read should cost him **~10 minutes/month**, saving **~3.5–4 hrs per cycle**. But that upside is entirely contingent on the rubric FITTING: a confidently-wrong score he has to mentally re-translate ("ignore the testing dimension, that's noise for us") saves him *nothing* — it adds a debunking step. Mis-fit doesn't just reduce the time-saved, it inverts it.

## Senior-quality bar (reliability floor)
The fleet read and per-repo scores must be at least as good as Arjun's own senior read of an ML repo: it must recognize that a notebook-heavy training repo with no unit tests and irregular commits can still be *mature ML work*, and it must not recommend web-dev hygiene as the "highest-leverage move." A roadmap that says "add automated testing / adopt conventional commits" to a research repo — ignoring that the stack doesn't use them — is exactly the senior-rejected output. And a month-over-month move he can't distinguish from guardband noise fails the bar even if the dashboard renders beautifully.

## Scored acceptance criteria (judged identically every run)
- [ ] **Stack-fit:** an ML/notebook repo is not dragged to L1–L2 purely for missing unit tests / CI / conventional commits that don't apply; the archetype lens reflects the stack (not just solo/team/org by stars+CODEOWNERS).
- [ ] **Notebook visibility:** `.ipynb` files are recognized as code/work, not invisible — the repo doesn't read as empty or untested because its work lives in notebooks.
- [ ] **Recurring-value (new each cycle):** this month's read surfaces a change since last month that he didn't already know — movers/trajectory say *what changed*, not just restate the number.
- [ ] **Noise vs. signal:** a score move is labeled real (R²/flat-floor/period-delta provenance) vs. re-scan wobble, where the move is shown.
- [ ] **Price-legibility:** he can map 40 credits/mo to the 500 allotment + 365-day window and judge cost↔value at Team, even without a subscription $.
- [ ] **Senior bar:** he'd quote the fleet number + top move to his VP without first having to debunk a stack-mismatched finding.

## Emotional baseline
Skeptical, stack-literate, allergic to web-shop assumptions dressed as universal truth. He doesn't bounce on friction — he digs to find the mis-calibration and then judges hard. Warms up if the tool *names its own blind spot* ("this rubric is tuned for app repos; ML signals are partial"); turns cold and final the moment it confidently scores his research repo as immature for the wrong reasons. Renewal-minded but not sentimental: if each cycle is the same number re-skinned, or the number is measuring the wrong stack, he downgrades or churns without drama.
