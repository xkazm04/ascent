# Redesign a tab without losing its purpose

Use this procedure when a working screen needs a fresh design, rather than incremental restyling.
The first application was UI surfaces; Registry v2 applies the same process to an operational screen.

1. **Read the product before drawing it.** Inspect the actual screen, loader, permissions, actions,
   links and empty/error states. Write down the user's main job, the evidence available to show it,
   and the actions that actually exist. Distinguish measured zeroes from missing instrumentation.
2. **Set the visual contract.** Read the app's tokens and an accepted reference screen. Reuse its
   colors, typography scale, fonts, spacing rhythm and focus treatment. Borrow visual consistency;
   do not inherit an unsuitable layout just because a component already exists.
3. **Design the information hierarchy from scratch.** Decide what the first viewport must answer.
   Show relationships spatially, counts with their units, and status beside the object it describes.
   Keep explanatory text only where it changes a decision. Put secondary mechanics in disclosures.
4. **Build a parallel, real tab.** Keep the current experience available for comparison. Reuse data
   loaders, authorization rules and mutation behavior; separate those from presentation. Never wire
   a decorative control to a fake action. Keep fixtures visibly separate from live organization data.
5. **Review the states, not just the hero.** Check empty, populated, loading, failure, read-only and
   partial completion. Exercise actions with mocked endpoints. Verify desktop/mobile overflow,
   keyboard controls, readable type and accessible names in the browser. Do not test by creating
   real remote repositories or PRs. Check both overview and detail workflows.
6. **Record and ship the comparison.** Update feature documentation and its source mapping, run
   relevant checks, and commit the experiment. Describe what changed and what is still unknown.
   Promote only after the user accepts it; then remove the old implementation and preserve old
   links where appropriate. Do not leave two competing permanent implementations by accident.

## What transfers between Surfaces and Registry

Surfaces is an exploration library: a scannable gallery leads to interactive demonstrations.
Registry is a source-management workflow: the user connects a repository, indexes its contents,
and distributes shared artifacts. A gallery alone would obscure its setup dependencies.

Registry v2 therefore uses a source → index → fleet diagram, a contextual action area, three
artifact inventories, and expandable commands, setup milestones, health and activity. The diagram
uses real identity and index evidence. Fleet sync coverage is explicitly **not measured** because
the current loader supplies placeholder zeroes. Registry and direct-API usage remain separate.

The reusable lesson is to keep the design language and action contract consistent while choosing
an information structure that fits each screen. It is not to apply one layout to every tab.
