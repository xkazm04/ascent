import { describe, expect, it } from "vitest";
import { dueBucketFor } from "@/lib/db/org";

// Pure due-date bucketing behind the org backlog's "by due date" grouping. UTC date-only dates keep
// these assertions free of the runner's local timezone.
describe("dueBucketFor", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("buckets a missing due date as no_date", () => {
    expect(dueBucketFor(null, now)).toBe("no_date");
  });

  it("buckets a past date as overdue", () => {
    expect(dueBucketFor(day("2026-06-01"), now)).toBe("overdue");
    expect(dueBucketFor(day("2026-01-01"), now)).toBe("overdue");
  });

  it("buckets today and the next 7 days as this_week", () => {
    expect(dueBucketFor(day("2026-06-02"), now)).toBe("this_week"); // today (d=0)
    expect(dueBucketFor(day("2026-06-09"), now)).toBe("this_week"); // d=7 (inclusive)
  });

  it("buckets 8..31 days out as this_month", () => {
    expect(dueBucketFor(day("2026-06-10"), now)).toBe("this_month"); // d=8
    expect(dueBucketFor(day("2026-07-03"), now)).toBe("this_month"); // d=31 (inclusive)
  });

  it("buckets beyond ~a month as later", () => {
    expect(dueBucketFor(day("2026-07-04"), now)).toBe("later"); // d=32
    expect(dueBucketFor(day("2027-01-01"), now)).toBe("later");
  });

  it("treats the due date as date-only (time of day on `now` doesn't shift the bucket)", () => {
    const lateInDay = new Date("2026-06-02T23:59:59Z");
    expect(dueBucketFor(day("2026-06-02"), lateInDay)).toBe("this_week"); // still today, not overdue
  });
});
