# UI surfaces

**Status: CURRENT** (2026-09-09). The visual library developed as Knowledge base v2
is now the sole UI surfaces implementation.

## Navigation and URLs

**Shared > UI surfaces** opens `/org/<slug>?tab=surfaces`. The original Knowledge base
remains a separate tab. The experimental Knowledge base v2 entry is removed from navigation
and the tab catalog; `?tab=knowledge-v2` permanently redirects (308) to `?tab=surfaces`, preserving subject,
technique, period and repeated query parameters.

| URL | View |
| --- | --- |
| `?tab=surfaces` | Visual gallery, category filters and search |
| `&subject=<slug>` | Interactive study or reference-only subject |
| `&subject=<slug>&technique=<slug>` | Study with reference techniques expanded and the requested technique highlighted |

Unknown subjects return to the gallery with a notice. Unknown techniques show a notice
inside the reference section. Tab switches clear subject and technique; links within the
library preserve cross-tab scope and period. Previous/next links follow the study order.
Filters are local state and survive returning from a study while the library stays mounted.

## Collection

The library lists 33 subjects in five categories. It defaults to the 14 interactive studies;
?Include reference-only? reveals all subjects. Search matches titles, short descriptions and
reference technique names. Categories without a study offer the reference-only view.
Reference-only cards link to the subject reader in Knowledge base.

Each study uses local sample data. Reset restores its initial state. Data studies include
searchable, sortable, selectable, paginated repositories; activity insertion; period charts;
graph node inspection; split/unified comparisons; and folder/document navigation. Feedback
studies include appearance, motion, manually selected fidelity, async states, statuses,
keyboard-friendly forms and save/undo notifications. These are focused demonstrations;
fidelity selection is manual, not a hardware probe.

?Behind the interface? lists related techniques and links to the Knowledge base reader.
These are reference topics, not a claim that the simplified study implements every technique.
The old source excerpts and mechanism descriptions were removed with the implementations
they described. There are no links back to a legacy showcase and no digest-freshness claim.

## Appearance and accessibility

The independent gallery/study layouts use CSS modules bound to Ascent's shared tokens:
translucent slate panels, ink canvas, azure accent and semantic status colors. Geist Sans
carries reading text and controls; Geist Mono carries metadata, code and figures. Shared
sizes include 15px controls/secondary copy, 13px metadata, 21px card titles and 31px detail
titles. Decorative miniature text respects the 12px floor. The appearance study defaults
to Ascent with Mint and Amber variants drawn from the same tokens.

The library supports org and personal workspaces, visible keyboard focus, native controls,
reduced motion and narrow layouts. Playgrounds load on the client so their forms cannot
submit before event handlers attach.

## Implementation and authoring

- `src/features/shared/surfaces/SurfacesTab.tsx`: gallery, filtering and subject selection.
- `Playground.tsx`: study frame, reset, reference disclosure and adjacent navigation.
- `DataPlayground.tsx`, `DataCharts.tsx`, `DiffStudy.tsx`: data demonstrations.
- `FeedbackPlayground.tsx`, `AppearanceStudy.tsx`: feedback and appearance demonstrations.
- `ReferenceNotes.tsx`: reference technique list and knowledge-reader link.
- `src/lib/org/surface-catalog.ts`: taxonomy and study availability; shared with Knowledge base.
- `src/lib/org/surface-studies.ts`: registry technique vocabulary for implemented studies.
- `next.config.ts`: experimental URL compatibility redirect, before page rendering.

To add a study, implement its playground and preview, add its description and reference
techniques, and extend the catalog/interaction tests. Keep feature files at 200 lines or fewer.
The former project-local `/surface` scaffold was removed because it generated the retired
scene/rail/drawer contract. The old scene bodies, fixture engines, loaders, spotlight system,
freshness join and their implementation-specific tests are deleted.
