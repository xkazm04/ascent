// The `design-tokens` showcase body, what `SURFACE_BODIES["design-tokens"]` resolves to: the
// composed appearance panel plus the drawer entries.

import type { SurfaceBody } from "../surfaceBody";
import { Scene } from "./Scene";
import { techniques } from "./techniques";

export const body: SurfaceBody = { Scene, techniques };
