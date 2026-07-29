// G6-07 — what the headline strip's live region SAYS.
//
// The point of these assertions is the sentence, not the attribute: a live region that fires is
// worthless if what it reads is "62 58 66 12/38". Every tile's identity, value and direction has to
// survive into speech, with no glyphs (SRs read "▲" inconsistently — from "black up-pointing
// triangle" to silence) and no repeated boilerplate.

import { describe, expect, it } from "vitest";
import { headlineAnnouncement } from "@/components/org/intelligence/live/warRoomAnnounce";

const stats = { avgOverall: 62, avgAdoption: 58, avgRigor: 66, aiNative: 12, scored: 38 };

describe("headlineAnnouncement", () => {
  it("names every tile — label, value, and the AI-Native ratio with its denominator", () => {
    const s = headlineAnnouncement(stats, null);
    expect(s).toBe(
      "Fleet headline metrics: org maturity 62; AI adoption 58; engineering rigor 66; 12 of 38 scored repos AI-Native.",
    );
  });

  it("speaks direction as words, never as an arrow glyph, and names the period once", () => {
    const s = headlineAnnouncement(stats, { overall: 4, adoption: 3, rigor: -1 });
    expect(s).toBe(
      "Fleet headline metrics: org maturity 62, up 4; AI adoption 58, up 3; engineering rigor 66, down 1; " +
        "12 of 38 scored repos AI-Native. Changes since campaign kickoff.",
    );
    expect(s).not.toMatch(/[▲▼＝]/);
    // "since campaign kickoff" is said ONCE, not three times.
    expect(s.match(/kickoff/g)).toHaveLength(1);
  });

  it("omits the movement clause entirely when nothing moved", () => {
    const s = headlineAnnouncement(stats, { overall: 0, adoption: 0, rigor: 0 });
    expect(s).not.toMatch(/kickoff/);
    expect(s).not.toMatch(/\bup\b|\bdown\b/);
  });

  it("names the empty state rather than reading a wall of em-dashes", () => {
    expect(headlineAnnouncement({ avgOverall: null, avgAdoption: null, avgRigor: null, aiNative: 0, scored: 0 }, null)).toBe(
      "Fleet headline metrics: no repos scored yet.",
    );
  });

  it("skips a metric with no average instead of saying 'null'", () => {
    const s = headlineAnnouncement({ ...stats, avgAdoption: null }, null);
    expect(s).not.toMatch(/adoption/i);
    expect(s).toMatch(/org maturity 62; engineering rigor 66/);
  });

  it("singularises a one-repo fleet", () => {
    expect(headlineAnnouncement({ ...stats, aiNative: 1, scored: 1 }, null)).toMatch(/1 of 1 scored repo AI-Native/);
  });

  it("drops a non-finite delta rather than announcing 'up NaN' (matches fmtDelta's em-dash policy)", () => {
    const s = headlineAnnouncement(stats, { overall: Number.NaN, adoption: Number.POSITIVE_INFINITY, rigor: 2 });
    expect(s).not.toMatch(/NaN|Infinity/);
    expect(s).toMatch(/org maturity 62;/);
    expect(s).toMatch(/engineering rigor 66, up 2/);
  });
});
