// The Members tab's future-moment renderer. Pinned because the invite mail already states the same
// deadline in words ("expires in 3 days", src/lib/email/invite.ts daysUntil) while the owner's own
// list stated it as a raw host-locale date — one deadline, two forms, and the owner left to subtract
// dates to find the invite about to lapse. These bands must count days the way the mail counts them.

import { describe, it, expect } from "vitest";
import { expiresIn, absoluteMoment } from "./memberTime";

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe("expiresIn", () => {
  it("counts whole days out, in the plural the mail uses", () => {
    expect(expiresIn(inDays(6), NOW)).toBe("expires in 6 days");
    expect(expiresIn(inDays(2), NOW)).toBe("expires in 2 days");
  });

  it("names the near bands rather than saying '1 days'", () => {
    expect(expiresIn(inDays(1), NOW)).toBe("expires tomorrow");
    expect(expiresIn(new Date(NOW + 3 * 3_600_000).toISOString(), NOW)).toBe("expires today");
  });

  it("says a lapsed invite is expired, never a negative countdown", () => {
    expect(expiresIn(inDays(-1), NOW)).toBe("expired");
    expect(expiresIn(new Date(NOW).toISOString(), NOW)).toBe("expired");
  });

  it("degrades honestly on an unparseable timestamp instead of rendering NaN", () => {
    expect(expiresIn("not-a-date", NOW)).toBe("expiry unknown");
    expect(absoluteMoment("not-a-date")).toBe("unknown");
  });

  it("agrees with the invite mail's own day count on the 7-day TTL", () => {
    // src/lib/email/invite.ts daysUntil: Math.round((t - nowMs) / 86_400_000), floored at 0.
    const iso = inDays(7);
    const mailDays = Math.max(0, Math.round((Date.parse(iso) - NOW) / 86_400_000));
    expect(expiresIn(iso, NOW)).toBe(`expires in ${mailDays} days`);
  });
});
