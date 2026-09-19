// The Trace panel's wire types and its one fetch (#36). Split from the components so the shapes are
// stated once and the panel stays presentation.
//
// Deliberately not a hook and not cached across mounts: a Trace is fetched when someone opens ONE
// skill's disclosure, and the server already caches per registry head. A client-side store here
// would be a second cache with its own staleness rules, answering a question the server's key
// already answers.

export interface TraceEntryView {
  sha: string;
  authoredAt: string;
  authorLogin: string | null;
  message: string;
  /** Null = the version was not resolved for this commit. Renders "—", never the neighbour's. */
  version: string | null;
}

export interface TraceLessonView {
  id: string;
  versionUsed: string;
  learnedOn: string | null;
  project: string;
  headingRaw: string;
  body: string;
}

export interface TraceResponse {
  skill: string;
  path: string;
  headSha: string;
  entries: TraceEntryView[];
  truncated: boolean;
  lessons: TraceLessonView[];
  cached: boolean;
  /** The cache was served because ascent could not reach GitHub — an older timeline, said so. */
  stale?: boolean;
  /** Present when no timeline could be built. The panel must show THIS, not an empty list. */
  error?: string;
}

/** Fetch one skill's trace. Never throws: a transport failure becomes the same honest `error` shape
 *  the route itself returns, so the panel has exactly one thing to render. */
export async function fetchSkillTrace(slug: string, skill: string): Promise<TraceResponse> {
  const empty = (error: string): TraceResponse => ({
    skill,
    path: "",
    headSha: "",
    entries: [],
    truncated: false,
    lessons: [],
    cached: false,
    error,
  });
  try {
    const res = await fetch(
      `/api/org/${encodeURIComponent(slug)}/registry/trace?skill=${encodeURIComponent(skill)}`,
      { headers: { accept: "application/json" } },
    );
    const body = (await res.json().catch(() => null)) as (TraceResponse & { error?: string }) | null;
    if (!res.ok) return empty(body?.error ?? `History is unavailable (${res.status}).`);
    if (!body) return empty("History is unavailable — the response could not be read.");
    return body;
  } catch {
    return empty("History is unavailable — the request did not complete.");
  }
}
