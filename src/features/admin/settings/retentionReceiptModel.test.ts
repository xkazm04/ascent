// Pins the retention receipt: did a purge remove anything since this policy was saved? A purge that
// removes nothing writes no audit row by design, so the copy says "nothing removed", never "did not run".

import { describe, expect, it } from "vitest";
import { retentionReceiptModel } from "./retentionReceiptModel";

const T1 = "2026-10-03T08:00:00.000Z";
const T2 = "2026-10-21T02:00:00.000Z";
const purge = (at: string) => ({ at, meta: { scansDeleted: 12, usageEventsDeleted: 3, digestsWritten: 9, policy: { maxScansPerRepo: 10, auditDays: 30 } } });
const save = (at: string) => ({ at, meta: {} });

describe("retentionReceiptModel", () => {
  it("is applied when the newest purge row is after the newest save, counting deletions only", () => {
    const m = retentionReceiptModel({ lastPurge: purge(T2), lastSave: save(T1) });
    expect(m.state).toBe("applied");
    expect(m.text).toBe("Last purge removed 15 rows on 2026-10-21");
    expect(m.saved).toBe("Policy saved 2026-10-03");
  });

  it("says nothing was removed since save when the newest purge row predates the save", () => {
    const m = retentionReceiptModel({ lastPurge: purge(T1), lastSave: save(T2) });
    expect(m.state).toBe("not-since-save");
    expect(m.text).toBe("No purge has removed anything since this policy was saved");
    expect(m.text).not.toMatch(/did not run|never ran/i);
  });

  it("is never when this org has no purge row", () => {
    const m = retentionReceiptModel({ lastPurge: null, lastSave: save(T1) });
    expect(m.state).toBe("never");
    expect(m.text).not.toMatch(/did not run|never ran/i);
  });

  it("is applied when a purge removed rows and no policy was ever saved", () => {
    expect(retentionReceiptModel({ lastPurge: purge(T2), lastSave: null }).state).toBe("applied");
  });

  it("is unknown when the receipt could not be read", () => {
    expect(retentionReceiptModel(null).state).toBe("unknown");
  });

  it("writes no em dash into any state's copy", () => {
    const all = [
      retentionReceiptModel({ lastPurge: purge(T2), lastSave: save(T1) }),
      retentionReceiptModel({ lastPurge: purge(T1), lastSave: save(T2) }),
      retentionReceiptModel({ lastPurge: null, lastSave: null }),
      retentionReceiptModel(null),
    ];
    for (const m of all) expect(`${m.text} ${m.saved ?? ""}`).not.toContain("\u2014");
  });
});
