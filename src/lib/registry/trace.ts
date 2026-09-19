// The per-skill version timeline (#36) — commits over `skills/<name>/SKILL.md`, folded with the
// versions resolved from a few of those commits' blobs.
//
// HOW MUCH GIT THIS READS, pinned. "A version timeline from git history" cannot mean a blob read per
// commit per skill inside the index pass: at the `MAX_INDEXED_FILES` ceiling of 500 skills that is
// thousands of extra reads on every push. So commits are read ON DEMAND, per skill, capped at
// TRACE_COMMITS, and only the newest TRACE_VERSION_READS of them have their blob read to resolve a
// version. Everything older carries `version: null` and renders "—".
//
// It would be easy — and wrong — to carry the next-newest version backwards over those older
// commits. It looks like more history and it is a fabrication: the whole point of this timeline is
// that a reader can trust which method produced which lesson.
//
// PURE. The GitHub reads are `listPathCommits` in ./read; the cache is @/lib/db/org-skill-trace.

/** Commits read per skill. Thirty is a long life for one skill file and bounds one on-demand read. */
export const TRACE_COMMITS = 30;

/** Blob reads per trace. Six versions is enough to group the lessons anyone is actually looking at,
 *  and it is the cost that would otherwise scale with the whole history. */
export const TRACE_VERSION_READS = 6;

/** One commit over the skill's path, as GitHub reports it. */
export interface PathCommit {
  sha: string;
  authoredAt: string;
  /** GitHub login of the author, when the commit is attributed to an account. Null otherwise —
   *  never substituted with the committer name, which is a different fact. */
  authorLogin: string | null;
  message: string;
}

export interface SkillTraceEntry {
  sha: string;
  authoredAt: string;
  authorLogin: string | null;
  message: string;
  /** The `version` this commit's SKILL.md declared. Null = not resolved (beyond the read budget, or
   *  the file at that commit declared none). NEVER the neighbouring version. */
  version: string | null;
}

/** Fold commits + the versions resolved for some of them into the timeline, newest first. */
export function buildTrace(commits: PathCommit[], versions: Map<string, string>): SkillTraceEntry[] {
  return commits
    .map((c) => ({
      sha: c.sha,
      authoredAt: c.authoredAt,
      authorLogin: c.authorLogin,
      // One line: a commit body in a timeline row is noise, and the subject is what a reader scans.
      message: (c.message.split("\n")[0] ?? "").slice(0, 200),
      version: versions.get(c.sha) ?? null,
    }))
    .sort((a, b) => Date.parse(b.authoredAt) - Date.parse(a.authoredAt));
}

export interface TraceGroup {
  /** The version these commits declared. Null = the version could not be resolved for them. */
  version: string | null;
  entries: SkillTraceEntry[];
  lessons: LessonLike[];
  /**
   * True for the group holding lessons whose declared version matches no resolved commit. It is
   * labelled rather than merged: a lesson written against 1.2.0 is evidence about 1.2.0 even when
   * the commit that shipped it is older than the read budget.
   */
  unplaced?: boolean;
}

/** The shape `groupLessonsByVersion` needs — structurally satisfied by `SkillLessonRow`. */
export interface LessonLike {
  id: string;
  versionUsed: string;
  learnedOn: string | null;
}

/**
 * Group the timeline by version and hang each lesson on the version it ITSELF declares.
 *
 * Never on commit proximity. A nearest-commit heuristic would silently attach a lesson to the wrong
 * version whenever the run that produced it lagged the release — which is the common case, not the
 * edge one — and the resulting attribution would look authoritative while being invented.
 */
export function groupLessonsByVersion(entries: SkillTraceEntry[], lessons: LessonLike[]): TraceGroup[] {
  const groups: TraceGroup[] = [];
  const byVersion = new Map<string, TraceGroup>();

  for (const e of entries) {
    if (e.version === null) {
      // Unresolved commits share ONE trailing group rather than one group each — they are "history
      // we did not read", which is a single fact about the read budget, not a version.
      const last = groups[groups.length - 1];
      if (last && last.version === null && !last.unplaced) last.entries.push(e);
      else groups.push({ version: null, entries: [e], lessons: [] });
      continue;
    }
    const existing = byVersion.get(e.version);
    if (existing) {
      existing.entries.push(e);
      continue;
    }
    const group: TraceGroup = { version: e.version, entries: [e], lessons: [] };
    byVersion.set(e.version, group);
    groups.push(group);
  }

  const unplaced: LessonLike[] = [];
  for (const l of lessons) {
    const group = l.versionUsed ? byVersion.get(l.versionUsed) : undefined;
    if (group) group.lessons.push(l);
    else unplaced.push(l);
  }
  if (unplaced.length) groups.push({ version: null, entries: [], lessons: unplaced, unplaced: true });
  return groups;
}

/** The label for a group, so the panel and any brief say the same thing. */
export function traceGroupLabel(group: TraceGroup): string {
  if (group.unplaced) return `version not in the last ${TRACE_COMMITS} commits`;
  return group.version ?? "version not resolved";
}
