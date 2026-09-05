// THE SCRUB IS THE GUARD (#18). This payload is the only thing in the item that leaves the
// deployment, and it leaves into a repo the customer may have made public — so what must never
// appear is asserted directly, rather than inferred from the builder being careful.

import { describe, expect, it } from "vitest";
import { assertNoLeaks, buildSignalsPayload, deriveContributorId, isValidContributor } from "./signals-contribution";
import { SIGNALS_SCHEMA } from "./layout";

const input = (over: Partial<Parameters<typeof buildSignalsPayload>[0]> = {}) => ({
  contributor: "ascent-0123456789ab",
  windowDays: 30,
  generatedAt: "2026-08-29T12:00:00.000Z",
  subjects: [
    {
      bundle: "software-engineering",
      subjectSlug: "quality-gates",
      consults: 12,
      deviations: 2,
      citations: { resolved: 5, moved: 1, gone: 0 },
    },
  ],
  ...over,
});

const doc = (over?: Partial<Parameters<typeof buildSignalsPayload>[0]>) => JSON.parse(buildSignalsPayload(input(over)).body);

describe("buildSignalsPayload", () => {
  it("emits exactly the closed key set", () => {
    expect(Object.keys(doc())).toEqual(["schema", "contributor", "app", "generatedAt", "windowDays", "bundles"]);
    expect(doc().schema).toBe(SIGNALS_SCHEMA);
  });

  it("carries counts only — never a repo, a path or a per-repo breakdown", () => {
    const body = buildSignalsPayload(input()).body;
    expect(body).not.toMatch(/repo/i);
    expect(body).not.toMatch(/src\//);
    expect(assertNoLeaks(body)).toEqual({ ok: true });
  });

  it("OMITS a key nobody measured rather than writing 0", () => {
    // A zero here would tell the corpus's curator that nobody consults a subject — an argument for
    // deleting good knowledge, made out of silence.
    const d = doc({
      subjects: [{ bundle: "se", subjectSlug: "s", consults: null, deviations: 3, citations: { resolved: null, moved: null, gone: null } }],
    });
    const entry = d.bundles.se.subjects.s;
    expect(entry).toEqual({ deviations: 3 });
    expect("consults" in entry).toBe(false);
    expect("citations" in entry).toBe(false);
  });

  it("drops a subject with nothing measured at all", () => {
    const d = doc({ subjects: [{ bundle: "se", subjectSlug: "s", consults: null, deviations: null }] });
    expect(d.bundles.se.subjects).toEqual({});
    expect(buildSignalsPayload(input({ subjects: [{ bundle: "se", subjectSlug: "s", consults: null, deviations: null }] })).subjects).toBe(0);
  });

  it("includes stack only when it is known", () => {
    expect("stack" in doc()).toBe(false);
    expect(doc({ stack: ["typescript"] }).stack).toEqual(["typescript"]);
  });

  it("digests the exact bytes that will be written", () => {
    const a = buildSignalsPayload(input());
    const b = buildSignalsPayload(input());
    expect(a.digest).toBe(b.digest);
    expect(buildSignalsPayload(input({ generatedAt: "2026-08-30T00:00:00.000Z" })).digest).not.toBe(a.digest);
  });
});

describe("assertNoLeaks", () => {
  const withValue = (v: unknown) =>
    JSON.stringify({ schema: SIGNALS_SCHEMA, contributor: "ascent-1", app: "ascent", generatedAt: "2026-08-29T00:00:00.000Z", windowDays: 30, bundles: v });

  it("rejects a path-shaped value", () => {
    const r = assertNoLeaks(withValue({ se: { subjects: { s: { note: "src/lib/x.ts:12" } } } }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("forbids paths");
  });

  it("rejects a URL", () => {
    expect(assertNoLeaks(withValue({ se: { subjects: { s: { note: "https://github.com/acme/api" } } } })).ok).toBe(false);
  });

  it("rejects an address-shaped value", () => {
    expect(assertNoLeaks(withValue({ se: { subjects: { s: { note: "dev@acme.com" } } } })).ok).toBe(false);
  });

  it("rejects a repo full name used as a KEY, not only as a value", () => {
    const r = assertNoLeaks(withValue({ "acme/api": { subjects: {} } }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("(key)");
  });

  it("rejects a windows-style path", () => {
    expect(assertNoLeaks(withValue({ se: { subjects: { s: { note: "C:\\src\\x.ts" } } } })).ok).toBe(false);
  });

  it("exempts the lane's own schema tag and the ISO instant, and nothing else", () => {
    // Both legitimately contain the characters the scrub hunts for, and both are structural rather
    // than pointers — so they are exempted BY PATH, one value wide, never by pattern.
    expect(assertNoLeaks(buildSignalsPayload(input()).body)).toEqual({ ok: true });
  });

  it("refuses a payload that is not JSON rather than passing it through", () => {
    expect(assertNoLeaks("not json").ok).toBe(false);
  });
});

describe("deriveContributorId", () => {
  it("is stable, opaque and provably not a name", () => {
    const id = deriveContributorId("org-1", "reg-1");
    expect(id).toBe(deriveContributorId("org-1", "reg-1"));
    expect(id).not.toBe(deriveContributorId("org-2", "reg-1"));
    expect(isValidContributor(id)).toBe(true);
    expect(id).toMatch(/^ascent-[0-9a-f]{12}$/);
  });

  it("refuses a contributor id carrying a slash — slugifying would publish an org name", () => {
    expect(isValidContributor("acme/dev")).toBe(false);
    expect(isValidContributor("Dev Box")).toBe(false);
    expect(isValidContributor("ok-name-1")).toBe(true);
  });
});
