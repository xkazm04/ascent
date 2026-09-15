// The registry's `usage/` lane — SINK B of the two-sink telemetry contract (#19): parsing it
// (`aggregateUsage`) and folding it into the dormancy verdict (`sampleEventStats`). PURE; the
// persistence lives in `@/lib/db/org-skill-usage-samples` and the orchestration in `index-registry`,
// which re-exports `aggregateUsage` so no call site had to move with it.
//
// WHY THIS LANE HAS NO REPO DIMENSION, ever. `../ai-registry/docs/usage-lane.md` forbids repository
// names, paths and per-project breakdown inside `usage/<contributor>.json`, and the registry's own
// `scripts/check-usage.mjs` enforces it on a public repo. So a sample can say "this skill ran 12 times
// for this contributor" and can never say where. The repo dimension exists on sink A (the tenant's own
// events API) or nowhere; bucketing these counts as "unattributed" would only invent a shape the data
// does not have.
//
// THE HONEST NULL THAT MATTERS: `lastUsed` is OPTIONAL in the file format. A sample without it
// contributes a COUNT and no recency, and `generatedAt` is never substituted for it. That substitution
// is the one tempting bug here — it would make every skill in an actively-regenerated registry read
// `active` forever, since the file is rewritten on every publish whether or not anyone ran anything.

import type { SkillEventStat } from "@/lib/db/org-skills";

/** One `usage/<contributor>.json` entry for one skill, as the file states it. */
export interface UsageSample {
  /** The file's stem — an installation, never a person and never a repo. */
  contributor: string;
  /** The registry skill NAME. A registry-only skill has no `OrgSkill` id, so the name is the key. */
  skillName: string;
  invokes: number;
  /** The window the contributor counted over, as it declared it. */
  windowDays: number;
  /** ISO instant of the last invocation, when the file reported one. NULL = not reported. */
  lastUsed: string | null;
  /** When the contributor generated the file. Staleness is the reader's problem — and it is NEVER a
   *  stand-in for `lastUsed`. */
  generatedAt: string;
}

/**
 * Fold samples into per-skill `invoke` stats keyed by `OrgSkill.id`.
 *
 * Matches on skill NAME because that is the only identifier the two sides share; a sample naming a
 * skill this org does not mirror is silently ignored rather than warned about, since a registry may
 * legitimately hold skills an org has not adopted.
 *
 * `lastAt` is null when no contributing sample reported a `lastUsed` — the count is real, the recency
 * is unknown, and the verdict downstream treats them as exactly that.
 */
export function sampleEventStats(
  samples: UsageSample[],
  skills: { id: string; name: string }[],
): SkillEventStat[] {
  const idByName = new Map(skills.map((s) => [s.name, s.id]));
  const byId = new Map<string, { count: number; lastAt: string | null }>();
  for (const s of samples) {
    const id = idByName.get(s.skillName);
    if (!id) continue;
    const n = Number.isFinite(s.invokes) && s.invokes > 0 ? Math.floor(s.invokes) : 0;
    const prev = byId.get(id) ?? { count: 0, lastAt: null };
    const at = s.lastUsed && Number.isFinite(Date.parse(s.lastUsed)) ? s.lastUsed : null;
    byId.set(id, {
      count: prev.count + n,
      lastAt: at && (!prev.lastAt || Date.parse(at) > Date.parse(prev.lastAt)) ? at : prev.lastAt,
    });
  }
  const out: SkillEventStat[] = [];
  for (const [skillId, v] of byId) {
    // A skill every contributor listed with zero invokes and no recency is not evidence of anything;
    // emitting a zero-count stat would only flip it out of `unmeasured` on the strength of silence.
    if (v.count === 0 && v.lastAt === null) continue;
    out.push({ skillId, type: "invoke", lastAt: v.lastAt, count: v.count });
  }
  return out.sort((a, b) => a.skillId.localeCompare(b.skillId));
}

/** Aggregate of the registry's `usage/` lane. */
export interface RegistryUsage {
  /** Total invocations across every contributor, over their reported window. */
  invokes30d: number;
  /** How many installations contributed a file. Zero means nobody is reporting —
   *  which is NOT the same as a fleet that runs nothing. */
  contributors: number;
  /** Per skill, summed across contributors. */
  bySkill: Record<string, number>;
  /**
   * The same counts UN-summed: one entry per (contributor, skill), which is what the
   * `OrgSkillUsageSample` snapshot persists (#19).
   *
   * `bySkill` alone could not be persisted safely — it is a total with no key, so a second index pass
   * of the same head has no way to tell "the same 40 invocations again" from "40 more". Keeping the
   * per-contributor grain gives the upsert a natural identity and makes re-indexing a no-op.
   */
  samples: UsageSample[];
  /** Every contributor whose file this pass actually read — the purge set. */
  contributorNames: string[];
}

/**
 * Sum the usage lane. Tolerant by the same rule as every other read here: a
 * malformed contribution degrades ITSELF into a warning and the rest still
 * counts. The registry's own gate is what keeps these files well-formed; this
 * must never be the thing that fails a whole index pass.
 */
export function aggregateUsage(
  files: { path: string; text: string | null }[],
  warnings: string[],
): RegistryUsage {
  const bySkill: Record<string, number> = {};
  const samples: UsageSample[] = [];
  const contributorNames: string[] = [];
  let contributors = 0;
  let invokes30d = 0;

  for (const { path, text } of files) {
    if (text === null) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      warnings.push(`${path}: not valid JSON — contribution skipped`);
      continue;
    }
    const record = doc as {
      skills?: Record<string, { invokes?: unknown; lastUsed?: unknown; windowDays?: unknown }>;
      generatedAt?: unknown;
      windowDays?: unknown;
    };
    const skills = record?.skills;
    if (!skills || typeof skills !== "object") {
      warnings.push(`${path}: no skills object — contribution skipped`);
      continue;
    }
    contributors += 1;
    // The file's stem IS the contributor id — `usage/acme-ci.json` → `acme-ci`. The lane forbids a
    // deeper path, and `isUsageFile` already refused anything nested, so this cannot be a repo name.
    const contributor = path.split("/").pop()!.replace(/\.json$/i, "");
    contributorNames.push(contributor);
    const fileWindow = typeof record.windowDays === "number" && record.windowDays > 0 ? Math.floor(record.windowDays) : 30;
    // An unparseable/absent `generatedAt` becomes the read instant. That is honest for THIS field
    // (we did read the file now) and is never allowed to stand in for `lastUsed`, which stays null.
    const generatedAt =
      typeof record.generatedAt === "string" && Number.isFinite(Date.parse(record.generatedAt))
        ? record.generatedAt
        : new Date().toISOString();

    for (const [name, entry] of Object.entries(skills)) {
      const n = entry?.invokes;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        warnings.push(`${path}: skills["${name}"].invokes is not a count — ignored`);
        continue;
      }
      const whole = Math.floor(n);
      bySkill[name] = (bySkill[name] ?? 0) + whole;
      invokes30d += whole;
      const lastUsed =
        typeof entry?.lastUsed === "string" && Number.isFinite(Date.parse(entry.lastUsed)) ? entry.lastUsed : null;
      samples.push({
        contributor,
        skillName: name,
        invokes: whole,
        windowDays: typeof entry?.windowDays === "number" && entry.windowDays > 0 ? Math.floor(entry.windowDays) : fileWindow,
        lastUsed,
        generatedAt,
      });
    }
  }
  return { invokes30d, contributors, bySkill, samples, contributorNames };
}
