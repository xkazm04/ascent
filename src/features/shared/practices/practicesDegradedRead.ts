// The Practices tab's degraded reads (server only). Each optional panel degrades to its fallback rather
// than failing the tab: an omitted panel is honest, an empty one would assert the org shares nothing.
// The degrade is deliberate; hiding it is not. Each one used to be `.catch(() => null)`, so a database
// outage looked the same as an org with nothing mined (council r2 sweep). Reported as well as logged:
// these are our own reads, so a failure is a defect or an outage, never an ordinary empty org.

import { reportHandledError } from "@/lib/api/respond";

/** A `.catch` handler that logs `what` for `slug` with the tab's tag, reports it, and answers `fallback`. */
export function degraded<T>(slug: string, what: string, fallback: T): (err: unknown) => T {
  return (err) => {
    console.error(`[practices/tab] ${what} read failed for ${slug}`, err);
    reportHandledError(err, { message: `Practices tab: the ${what} read failed; the panel degraded.` });
    return fallback;
  };
}
