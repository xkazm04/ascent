// MC-B14 — the ledger-integrity line. Before this the only reference to verification on the page was
// a non-interactive `<code>` string naming a URL, inside the card's NON-EMPTY branch, so a new org
// was never told the ledger is verifiable at all.

import { describe, expect, it } from "vitest";
import { ledgerIntegrityLine } from "./ledgerIntegrity";
import type { SealChain, SealCheck } from "@/lib/db/control-observations";

const check = (over: Partial<SealCheck> = {}): SealCheck => ({
  day: "2026-08-29",
  rowCount: 12,
  root: "root-a",
  prevRoot: null,
  sealedAt: "2026-08-30T00:00:00.000Z",
  signed: true,
  verdict: "ok",
  recomputedRoot: "root-a",
  rowsNow: 12,
  ...over,
});

const chain = (over: Partial<SealChain> = {}): SealChain => ({
  checks: [check()],
  chainOk: true,
  unsealedDays: ["2026-08-30", "2026-08-31"],
  sealBacklogRemaining: 0,
  ...over,
});

describe("ledgerIntegrityLine", () => {
  it("states what it verified THROUGH, and how many days are still waiting", () => {
    const v = ledgerIntegrityLine(chain());
    expect(v.headline).toBe("Ledger integrity: chain verified through 2026-08-29 · 2 days not yet chained");
    expect(v.tone).toBe("good");
  });

  // MC-B10: SEALED belongs to the AI-stance perimeter on this same tab. The ledger says "chained".
  it("never uses the word SEALED — that word means a no-AI zone on this tab", () => {
    const all = [chain(), chain({ checks: [] }), chain({ chainOk: false, checks: [check({ verdict: "tampered" })] })];
    for (const c of all) {
      const v = ledgerIntegrityLine(c);
      expect(`${v.headline} ${v.detail ?? ""}`.toLowerCase()).not.toContain("seal");
    }
  });

  it("says nothing is chained yet rather than showing a verified badge over nothing", () => {
    const v = ledgerIntegrityLine(chain({ checks: [] }));
    expect(v.headline).toContain("no day chained yet");
    expect(v.tone).toBe("unknown");
  });

  it("names the broken day and does not report it as verified", () => {
    const v = ledgerIntegrityLine(chain({ chainOk: false, checks: [check({ verdict: "tampered", recomputedRoot: "other" })] }));
    expect(v.headline).toContain("CHAIN BROKEN at 2026-08-29");
    expect(v.tone).toBe("bad");
    expect(v.headline).not.toContain("verified through");
  });

  // A purged day KEEPS its entry on purpose — that is what makes a deleted window visible.
  it("explains a no-rows day as retention, not as tampering", () => {
    const v = ledgerIntegrityLine(chain({ checks: [check(), check({ day: "2026-08-28", verdict: "no-rows", rowsNow: 0 })] }));
    expect(v.tone).not.toBe("bad");
    expect(v.detail).toContain("retention");
  });

  it("surfaces a backlog the next pass cannot clear — the condition retention can make permanent", () => {
    expect(ledgerIntegrityLine(chain({ sealBacklogRemaining: 9 })).detail).toContain("9 closed days");
  });

  // Silence about integrity is honest; a green tick over an unread chain is not.
  it("claims nothing when the chain could not be read", () => {
    const v = ledgerIntegrityLine(null);
    expect(v.tone).toBe("unknown");
    expect(v.headline).toContain("not readable");
  });
});
