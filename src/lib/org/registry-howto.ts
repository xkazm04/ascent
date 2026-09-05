// The developer-facing commands + manifest pointer for a registry, as ONE pure function.
//
// Split out of `registry-view.ts` so the FIXTURES (and therefore the client-side preview switcher in
// `src/features/shared/registry/RegistryPreviewShell.tsx`) can import it without dragging
// `registry-view.ts` — and through it the whole `@/lib/db` layer — across the client boundary. That
// is the exact failure mode recorded in the "build not in the gate" note: `tsc` and the unit suite
// stay green while `next build` fails on a server-only import reaching a client component.
//
// No imports beyond a type: safe on the server, in a route, and in a browser bundle.

import type { RegistryView } from "./registry-view";

/** The developer-facing commands + manifest pointer. Same strings on every path, real or fixture. */
export function registryHowTo(registryFullName: string): RegistryView["howTo"] {
  return {
    syncCmd: "npx ascent skills sync",
    hooksCmd: "npx ascent hooks install",
    pointer: `skills.registry: github:${registryFullName}`,
  };
}
