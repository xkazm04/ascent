# Scene template - `src/features/shared/surfaces/<slug>/`

The skeleton `/surface` fills in. Every file below is a starting point that already
type-checks against the contract in [`contract.md`](contract.md); replace the `<...>`
holes and the placeholder regions, keep the shape. **Every file stays at or under 200
LOC** (the `src/features/**` cap): when `Scene.tsx` approaches it, extract a region into
a co-located `Scene<Region>.tsx` in the same folder and import it - the operator prefers
folder refactors over per-technique cards.

Before writing, open the reference scene `src/features/shared/surfaces/motion/` (WP1's
proven body) and copy its exact `index.ts` export shape - the body map's loader and the
scene's export must agree, and `motion` is the one that has been run.

## `index.ts` - the body (no `"use client"`: it only re-exports)

```ts
import type { SurfaceBody } from "../surfaceBody";
import { Scene } from "./Scene";
import { TECHNIQUES } from "./techniques";

// One body per subject: the composed scene plus the technique list the rail and the
// drawer read. SURFACE_BODIES in ../surfaceBodies.ts loads it with import("./<slug>").
export const body: SurfaceBody = { Scene, techniques: TECHNIQUES };
```

## `techniques.ts` - what the rail lists and the drawer explains

```ts
import type { SurfaceTechnique } from "../surfaceBody";

// Order = rail order = the golden path's order. Every slug here has a region in Scene.tsx
// carrying data-technique="<slug>", and appears in the catalog record's techniqueSlugs
// (the bijection test in ../surfaceCatalog.test.ts enforces both directions).
export const TECHNIQUES: readonly SurfaceTechnique[] = [
  {
    slug: "<technique-slug>",
    title: "<Technique title>",
    // 3-6 sentences: what the technique prescribes, what the region does to embody it,
    // and what a viewer should watch for. Prose from YOUR read of the technique file,
    // not a paste of it.
    mechanism: "<...>",
    // A REAL excerpt of this scene's code (10-25 lines), copied after the scene is
    // final. The drawer renders it in a <pre>; the reader must be able to find it in
    // Scene.tsx by grep.
    source: [
      "<line of Scene.tsx>",
      "<line of Scene.tsx>",
    ].join("\n"),
    // Where Ascent already does this, or null. Never invent a file; the path came from
    // a grep you ran and can name in brief.md.
    inAscent: { file: "src/<real path>", note: "<one sentence: what that file does that matches>" },
    // Where the scene or Ascent departs from the technique and why, or null.
    deviation: null,
  },
];
```

## `fixtures.ts` - deterministic fiction, sized by the volume knob

```ts
import { SURFACE_VOLUMES } from "@/lib/org/surface-catalog";

export type SurfaceVolume = (typeof SURFACE_VOLUMES)[number];

// Fixtures are FICTION and the scene says so on screen (see Scene.tsx). They are
// deterministic: the same volume always yields the same rows, so the jsdom test and the
// screenshot are reproducible. No Math.random, no Date.now.
export type Row = { id: string; label: string; value: number; state: "ok" | "warn" | "fail" };

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function makeRows(volume: SurfaceVolume): Row[] {
  const next = seeded(volume);
  return Array.from({ length: volume }, (_, i) => {
    const r = next();
    return {
      id: `row-${i}`,
      label: `Repository ${i + 1}`,
      value: Math.round(r * 100),
      state: r > 0.85 ? "fail" : r > 0.6 ? "warn" : "ok",
    };
  });
}

// Data-display subjects render at most a window of the volume (the point of the knob
// is to show the technique surviving 50,000 rows, not to mount 50,000 nodes).
export const WINDOW = 40;
```

Subjects that are not data-display still accept `volume` (it is in the props type) and
may ignore it; say so in a comment rather than dropping the prop.

## `Scene.tsx` - ONE composed scene, one region per technique

```tsx
"use client";

import { motion } from "framer-motion";
import { Kicker, Surface } from "@/components/ui";
import type { SurfaceSceneProps } from "../surfaceBody";
import { makeRows, WINDOW } from "./fixtures";

// <Scene concept in one sentence: what composed surface this is and what a viewer
// does with it.> Each technique of the subject is a region carrying
// data-technique="<slug>"; the frame (../SurfaceFrame.tsx) spotlights the selected one
// and dims the rest, so the scene never styles selection itself.
export function Scene({ technique, reduced, volume }: SurfaceSceneProps) {
  const rows = makeRows(volume).slice(0, WINDOW);
  // `reduced` comes from props (the frame's MotionConfig + the simulate toggle). A
  // scene NEVER reads prefers-reduced-motion itself: the toggle must be able to
  // override the OS setting, and the jsdom test renders both paths.
  const entrance = reduced ? { opacity: 1 } : { opacity: [0, 1], y: [8, 0] };

  return (
    <div className="space-y-4">
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional rows,
        seeded. Nothing here is an Ascent org.
      </p>

      <Surface data-technique="<technique-slug>" className="rounded-xl p-4">
        <Kicker tone="muted">{"<Technique title>"}</Kicker>
        <motion.ul initial={false} animate={entrance} className="mt-3 space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between type-mono-sm">
              <span className="text-slate-300">{row.label}</span>
              <span className="tabular-nums text-slate-400">{row.value}</span>
            </li>
          ))}
        </motion.ul>
      </Surface>

      {/* One <Surface data-technique="..."> per remaining technique. When the file
          nears 200 LOC, move a region to ./Scene<Region>.tsx ("use client" only if
          it holds hooks or handlers) and render it here. */}
      {technique === "<technique-slug>" ? null : null /* selection is the frame's job */}
    </div>
  );
}
```

Rules the template already obeys and the scene must keep:

- Only `@/components/ui` primitives and `type-*` classes; no raw `text-xs`, no arbitrary
  pixel sizes, no hand-picked hexes (`@/lib/ui` for level/score color, `deltaHex` for
  deltas, `bg-accent` is the one accent).
- framer-motion is fine INSIDE the scene (the chunk is per subject); never import it in
  a shared frame file.
- No always-on loop without a visible pause control inside the region. A signature loop
  that the technique itself is about (a live dot, a poll cycle) renders its pause
  button in the same region and honors `reduced` by starting paused.
- A region may hold its own local state (hover, an expanded row, a paused loop); nothing
  reads the URL, the router or the org.
- `data-technique` is on the region's outermost element, one per slug, never nested.

## `brief.md` - the read, kept beside the code

```md
# <Subject title> - showcase brief

subject: <slug>
subcategory: <subcategory>
digest: <sha256:... from index.json subjects[<slug>].digest>
verifiedOn: <YYYY-MM-DD, the day of this read>
goldenPath: <registry-relative file from subjects[<slug>].file>

## Scene concept

<Three sentences: what composed surface this is, why it is the right host for every
technique of the subject, what a viewer does with it.>

## Techniques

### <technique-slug>
- use_when matched: "<the use_when entry from index.json this scene embodies>"
- mechanism to show: <what the region does, in the React/Tailwind/Motion toolset>
- region: <where in the scene it sits; co-located file if extracted>
- Ascent evidence: <src/... :line - what the grep found> (grep: `rg "<pattern>" src`)
  or: none found (grep: `rg "<pattern>" src` -> 0 hits)
- deviation: <how the scene or Ascent departs and why> or: none
- applications read: <react--<slug>.md, other stacks...> - mechanisms/numbers taken:
  <...>; nothing cited as Ascent's

## Out of the read

<Anything in the golden path the scene does not attempt, and why (e.g. server-side,
needs org data, another subject owns it).>
```

## `Scene.dom.test.tsx` - the jsdom gate

```tsx
// @vitest-environment jsdom
//
// The scene mounts in jsdom, every declared technique has exactly one region, the
// reduced path renders the same regions, and the fiction notice is visible. This is the
// per-scene half of the gate; the bijection test in ../surfaceCatalog.test.ts is the
// other half.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SURFACE_VOLUMES } from "@/lib/org/surface-catalog";
import body from "./index";

const { Scene, techniques } = body;

describe("<slug> scene", () => {
  it("mounts with every declared technique region present, once", () => {
    const { container } = render(
      <Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[0]} />,
    );
    for (const t of techniques) {
      expect(container.querySelectorAll(`[data-technique="${t.slug}"]`)).toHaveLength(1);
    }
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
  });

  it("renders the reduced path with the same regions and no blank canvas", () => {
    const { container } = render(
      <Scene technique={techniques[0].slug} reduced={true} volume={SURFACE_VOLUMES[0]} />,
    );
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("says its data is fiction", () => {
    render(<Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[1]} />);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
```

If the scene holds a loop with a pause control, add a case that the control exists in
the region and that `reduced: true` mounts it paused.
