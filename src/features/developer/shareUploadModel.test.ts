// The paste/drop preview runs the SERVER's own door (`validateCareShare`, `careShareLedger`) in the
// browser, so a share the route would refuse is refused before anything leaves the page.

import { afterEach, describe, expect, it, vi } from "vitest";
import { careSharePreview, CARE_SHARE_SECTION_LABEL, careSharePreviewCopy } from "./shareUploadModel";
import { CARE_SHARE_MAX_BYTES } from "@/lib/org/care-share-contract";
import { emptyDeveloperView, type DeveloperView } from "@/lib/org/developer-view";

const SHAPE = { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields: { planModePct: 40 } };

function viewWithMovesAndJournal(over: Partial<DeveloperView> = {}): DeveloperView {
  return {
    ...emptyDeveloperView("ada"),
    moves: [{ id: "m1", title: "Plan first", state: "trying", category: "session", why: "fewer retries", expectedSaving: 30, tryFor: 5, at: "2026-10-01T00:00:00.000Z", evidence: null }],
    journal: [{ at: "2026-10-02T00:00:00.000Z", line: "tried plan mode" }],
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("careSharePreview", () => {
  it("reads an empty paste as empty, with nothing to commit", () => {
    const p = careSharePreview("", emptyDeveloperView("ada"));
    expect(p.state).toBe("empty");
    expect(p.canCommit).toBe(false);
    expect(careSharePreview("   \n", emptyDeveloperView("ada")).state).toBe("empty");
  });

  it("names invalid JSON with the route's own sentence", () => {
    const p = careSharePreview("{not json", emptyDeveloperView("ada"));
    expect(p).toMatchObject({ state: "invalid", errors: ["The share is not valid JSON."] });
    expect(p.canCommit).toBe(false);
  });

  it("refuses a never-sent key with the validator the route runs", () => {
    const body = JSON.stringify({ contract: 1, moves: [{ id: "m1", transcript: "secret" }] });
    const p = careSharePreview(body, emptyDeveloperView("ada"));
    expect(p.state).toBe("refused");
    expect(p.canCommit).toBe(false);
    if (p.state !== "refused") throw new Error("unreachable");
    expect(p.errors.some((e) => e.includes("never-sent field: moves[0].transcript"))).toBe(true);
  });

  it("measures UTF-8 bytes, not characters, and never parses an oversized share", () => {
    const parse = vi.spyOn(JSON, "parse");
    // Two bytes per character: under the cap in characters, over it in bytes.
    const text = "é".repeat(CARE_SHARE_MAX_BYTES / 2 + 1);
    expect(text.length).toBeLessThan(CARE_SHARE_MAX_BYTES);
    const p = careSharePreview(text, emptyDeveloperView("ada"));
    expect(p.state).toBe("too-large");
    expect(p.canCommit).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it("previews a ready share: the ledger lights only what it carries, and says what stops being shared", () => {
    const p = careSharePreview(JSON.stringify({ contract: 1, shape: SHAPE }), viewWithMovesAndJournal());
    expect(p.state).toBe("ready");
    if (p.state !== "ready") throw new Error("unreachable");
    expect(p.canCommit).toBe(true);
    expect(p.lights).toEqual(["Plan-mode ratio"]);
    expect(p.stopsSharing).toEqual(["moves", "journal"]);
    expect(p.counts).toMatchObject({ shapeFields: 1, moves: null, journal: null, profile: false });
  });

  it("sends the exact text when the developer leaves consent off and the file names none", () => {
    const text = JSON.stringify({ contract: 1, shape: SHAPE }, null, 2);
    const p = careSharePreview(text, viewWithMovesAndJournal());
    if (p.state !== "ready") throw new Error("unreachable");
    expect(p.body).toBe(text);
    expect(p.consent).toBe(false);
  });

  it("never takes consent from the file: a file saying yes stays out until the developer ticks", () => {
    const text = JSON.stringify({ contract: 1, shape: SHAPE, consent: { orgAggregate: true } });
    const off = careSharePreview(text, emptyDeveloperView("ada"));
    if (off.state !== "ready") throw new Error("unreachable");
    expect(off.fileConsent).toBe(true);
    expect(JSON.parse(off.body).consent).toEqual({ orgAggregate: false });
    expect(off.lights).not.toContain("Anonymous org bands");

    const on = careSharePreview(text, emptyDeveloperView("ada"), true);
    if (on.state !== "ready") throw new Error("unreachable");
    expect(JSON.parse(on.body).consent).toEqual({ orgAggregate: true });
    expect(on.lights).toContain("Anonymous org bands");
  });

  it("lists the org bands as stopping when the stored share consented and this one does not", () => {
    const view = emptyDeveloperView("ada");
    view.setup.sharing = view.setup.sharing.map((r) => (r.field === "Anonymous org bands" ? { ...r, shared: true } : r));
    const p = careSharePreview(JSON.stringify({ contract: 1, shape: SHAPE }), view);
    if (p.state !== "ready") throw new Error("unreachable");
    expect(p.stopsSharing).toEqual(["consent"]);
  });

  it("cannot commit a preview fixture even when the share is ready", () => {
    const p = careSharePreview(JSON.stringify({ contract: 1, shape: SHAPE }), viewWithMovesAndJournal({ demo: "steady" }));
    expect(p.state).toBe("ready");
    expect(p.canCommit).toBe(false);
  });

  it("writes no em dash into any copy it owns", () => {
    for (const label of Object.values(CARE_SHARE_SECTION_LABEL)) expect(label).not.toContain("\u2014");
    for (const line of Object.values(careSharePreviewCopy)) expect(line).not.toContain("\u2014");
  });
});
