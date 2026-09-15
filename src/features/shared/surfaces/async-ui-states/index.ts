// The `async-ui-states` showcase body — what `SURFACE_BODIES["async-ui-states"]` resolves to.

import type { SurfaceBody } from "../surfaceBody";
import { Scene } from "./Scene";
import { techniques } from "./techniques";

export const body: SurfaceBody = { Scene, techniques };
