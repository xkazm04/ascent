// The `adaptive-fidelity-tiers` showcase body — what `SURFACE_BODIES["adaptive-fidelity-tiers"]`
// resolves to. Scene + drawer entries.

import type { SurfaceBody } from "../surfaceBody";
import { Scene } from "./Scene";
import { techniques } from "./techniques";

export const body: SurfaceBody = { Scene, techniques };
