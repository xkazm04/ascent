// Building — and SCRUBBING — the `signals/<contributor>.json` payload ascent contributes back to the
// customer's registry (#18).
//
// This is the one place in the item where data leaves the deployment, and it leaves into a repo the
// customer may well have made public. So the shape is KEY-CLOSED (built field by field from a typed
// input, never spread from a row) and then re-checked by `assertNoLeaks` before any write. Two
// independent mechanisms for one rule, deliberately: the closed builder is what makes a leak
// unlikely, and the scrub is what makes it detectable if the builder is ever edited carelessly.
//
// WHAT MAY NEVER APPEAR: a repository name, a path, a `file:line`, a URL, an email, a login, or any
// per-repo breakdown. The conformance evidence — the most useful thing ascent holds — is exactly the
// thing that can never travel, because it is a fact about one tree.
//
// Pure: no I/O, no database. `signals-pr.ts` does the writing.

import { createHash } from "node:crypto";
import { SIGNALS_SCHEMA } from "./layout";

export interface SignalsSubjectInput {
  bundle: string;
  subjectSlug: string;
  /** Times the fleet consulted the subject. Null = not measured; the key is omitted, not zeroed. */
  consults: number | null;
  /** Deviations against it, summed fleet-wide — never per repo. */
  deviations: number | null;
  citations?: { resolved: number | null; moved: number | null; gone: number | null };
}

export interface SignalsInput {
  /** `[a-z0-9-]`, stable, derived from ids rather than from anyone's name. */
  contributor: string;
  /** Major stack labels only ("typescript", "python"). Omitted when unknown — never guessed. */
  stack?: string[];
  windowDays: number;
  generatedAt: string;
  subjects: SignalsSubjectInput[];
}

/** A contributor id that is stable, opaque and provably not a name. */
export function deriveContributorId(orgId: string, registryId: string): string {
  return `ascent-${createHash("sha256").update(`${orgId}:${registryId}`).digest("hex").slice(0, 12)}`;
}

/** The lane's filename charset. A contributor id outside it is refused rather than slugified —
 *  slugifying would quietly turn `acme/dev` into `acme-dev` and publish an org name. */
export const CONTRIBUTOR_RE = /^[a-z0-9-]{3,64}$/;

export function isValidContributor(v: string): boolean {
  return CONTRIBUTOR_RE.test(v);
}

/**
 * Build the payload. KEY-CLOSED: every field is named here, so a row gaining a column later cannot
 * ride along into a public repo just because someone spread it.
 */
export function buildSignalsPayload(input: SignalsInput): { body: string; digest: string; subjects: number; deviations: number } {
  const bundles: Record<string, { subjects: Record<string, Record<string, unknown>> }> = {};
  let deviations = 0;
  let subjects = 0;

  for (const s of input.subjects) {
    const bundle = (bundles[s.bundle] ??= { subjects: {} });
    const entry: Record<string, unknown> = {};
    // A key nobody measured is OMITTED rather than written as 0 — the lane's reader treats a missing
    // key as null, and a zero would be a claim that nobody consulted a subject.
    if (s.consults !== null) entry.consults = s.consults;
    if (s.deviations !== null) {
      entry.deviations = s.deviations;
      deviations += s.deviations;
    }
    const c = s.citations;
    if (c && (c.resolved !== null || c.moved !== null || c.gone !== null)) {
      entry.citations = {
        ...(c.resolved !== null ? { resolved: c.resolved } : {}),
        ...(c.moved !== null ? { moved: c.moved } : {}),
        ...(c.gone !== null ? { gone: c.gone } : {}),
      };
    }
    if (!Object.keys(entry).length) continue;
    bundle.subjects[s.subjectSlug] = entry;
    subjects += 1;
  }

  const payload = {
    schema: SIGNALS_SCHEMA,
    contributor: input.contributor,
    app: "ascent",
    generatedAt: input.generatedAt,
    windowDays: input.windowDays,
    ...(input.stack?.length ? { stack: input.stack } : {}),
    bundles,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  return { body, digest: createHash("sha256").update(body).digest("hex"), subjects, deviations };
}

/** The one exempt value: the lane's own schema tag is literally `rkb-signals/1`. */
const EXEMPT_PATHS = new Set(["signals.schema"]);

/**
 * Reject a payload carrying anything path-, URL-, address- or repo-shaped.
 *
 * REFUSES, never scrubs. A scrub publishes whatever it missed, and the failure mode of "we removed
 * the paths we recognised" is a leak nobody notices. Refusing is loud and recoverable.
 */
export function assertNoLeaks(body: string): { ok: true } | { ok: false; reason: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return { ok: false, reason: "payload is not valid JSON" };
  }
  const offenders: string[] = [];
  const suspicious = (v: string) => v.includes("/") || v.includes("@") || v.includes("\\") || /https?:/i.test(v) || v.includes(":");
  const walk = (v: unknown, path: string) => {
    if (EXEMPT_PATHS.has(path)) return;
    if (typeof v === "string") {
      // `generatedAt` is an ISO instant, whose colons are structural rather than a pointer.
      if (path === "signals.generatedAt") return;
      if (suspicious(v)) offenders.push(`${path} = ${JSON.stringify(v.slice(0, 80))}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (suspicious(k)) offenders.push(`${path}.${k} (key)`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(doc, "signals");
  if (offenders.length) {
    return {
      ok: false,
      reason: `the signals lane forbids paths, repo names, URLs and addresses — found ${offenders.slice(0, 5).join("; ")}`,
    };
  }
  return { ok: true };
}
