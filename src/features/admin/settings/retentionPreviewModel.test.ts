// Pins the retention preview's per-ledger delta table: rows derive from PURGE_COUNTER_KEYS (never a
// hand list), labels come from the erase dialog's table, and an uncounted value reads as unknown.

import { describe, expect, it } from "vitest";
import { retentionPreviewModel, type PreviewRow } from "./retentionPreviewModel";
import { PURGE_COUNTER_KEYS } from "@/lib/db/retention-counters";

function result(over: Record<string, number | null> = {}): Record<string, unknown> {
  const counters = Object.fromEntries(PURGE_COUNTER_KEYS.map((k) => [k, 0]));
  return { orgSlug: "acme", policy: { maxScansPerRepo: 10, auditDays: 30, batchSize: 500 }, ...counters, digestsWouldWrite: 0, ...over };
}

function rows(m: ReturnType<typeof retentionPreviewModel>): PreviewRow[] {
  return m.groups.flatMap((g) => g.rows);
}

describe("retentionPreviewModel", () => {
  it("reports the edit's delta per ledger with the erase dialog's labels and groups", () => {
    const m = retentionPreviewModel(
      result({ controlObservationsDeleted: 0, usageEventsDeleted: 100 }),
      result({ controlObservationsDeleted: 40, usageEventsDeleted: 100 }),
    );
    expect(m.state).toBe("ready");
    const control = rows(m).find((r) => r.key === "controlObservationsDeleted");
    expect(control).toMatchObject({ label: "Control observations", group: "Governance", now: 0, proposed: 40, delta: 40, state: "known" });
    const usage = rows(m).find((r) => r.key === "usageEventsDeleted");
    expect(usage).toMatchObject({ label: "Usage events", group: "Governance", now: 100, proposed: 100, delta: 0 });
    expect(m.groups.find((g) => g.title === "Governance")?.rows.map((r) => r.key)).toContain("controlObservationsDeleted");
  });

  it("yields a row for every numeric counter the body carried, and omits one it did not", () => {
    const m = retentionPreviewModel(result(), result());
    const keys = rows(m).map((r) => r.key);
    for (const k of PURGE_COUNTER_KEYS) expect(keys).toContain(k);
    expect(keys).toContain("digestsWouldWrite");

    const partial = result();
    delete partial.memoryCitationsDeleted;
    expect(rows(retentionPreviewModel(partial, partial)).map((r) => r.key)).not.toContain("memoryCitationsDeleted");
  });

  it("propagates a null digest count as unknown, never 0", () => {
    const m = retentionPreviewModel(result({ digestsWouldWrite: 3 }), result({ digestsWouldWrite: null }));
    const d = rows(m).find((r) => r.key === "digestsWouldWrite");
    expect(d).toMatchObject({ state: "unknown", proposed: "unknown", delta: "unknown", now: 3 });
  });

  it("is unknown, with no rows, when the proposed body is missing", () => {
    expect(retentionPreviewModel(result(), null)).toEqual({ state: "unknown", groups: [] });
    expect(retentionPreviewModel(null, undefined)).toEqual({ state: "unknown", groups: [] });
  });

  it("marks the baseline unknown, not zero, when only the proposed body arrived", () => {
    const m = retentionPreviewModel(null, result({ scansDeleted: 4 }));
    const scans = rows(m).find((r) => r.key === "scansDeleted");
    expect(scans).toMatchObject({ now: "unknown", proposed: 4, delta: "unknown", state: "unknown" });
  });

  it("writes no em dash into any label or group", () => {
    const m = retentionPreviewModel(result(), result());
    const text = m.groups.map((g) => `${g.title} ${g.rows.map((r) => `${r.label} ${r.hint ?? ""}`).join(" ")}`).join(" ");
    expect(text).not.toContain("\u2014");
  });
});
