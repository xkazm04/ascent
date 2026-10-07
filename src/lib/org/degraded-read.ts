// The door for a best-effort read that degrades to a fallback. The fallback is the intent (a failed
// optional read costs its section, never the page), but the failure must leave a trace: a console.warn
// naming the read plus reportHandledError. Use as `.catch(degradedRead("what", fallback))`.
import { reportHandledError } from "@/lib/api/respond";

/** Log + report a read that failed; the caller keeps its own fallback value. */
export function noteReadFailure(read: string, err: unknown): void {
  console.warn(`[degraded-read] ${read} failed`, err instanceof Error ? err.message : err);
  reportHandledError(err, { message: `${read} failed` });
}

/** A `.catch` handler: note the failure, then answer `fallback`. */
export function degradedRead<T>(read: string, fallback: T): (err: unknown) => T {
  return (err) => {
    noteReadFailure(read, err);
    return fallback;
  };
}
