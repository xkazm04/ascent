// The pure fold behind the private session shape: whose rows count, over which window, and when a
// number is too thin to print.

import { describe, expect, it } from "vitest";
import {
  applyOwnSessionShape,
  careTelemetryWindowStart,
  ownSessionKeys,
  sessionKeyIsViewer,
  type OwnSessionRow,
} from "./care-session-telemetry";
import { emptyDeveloperView } from "./developer-view";
import { CARE_SHAPE_REASON_COPY, careShapeEmptyReason } from "./care-shape-contract";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
const rows = (key: string | null, n: number, daysAgo = 1): OwnSessionRow[] =>
  Array.from({ length: n }, () => ({ userKey: key, startedAt: at(daysAgo) }));

function fold(login: string | null, r: OwnSessionRow[]) {
  const view = emptyDeveloperView(login);
  applyOwnSessionShape(view, r, NOW);
  return view;
}

describe("sessionKeyIsViewer", () => {
  it("matches the login exactly after case folding", () => {
    expect(sessionKeyIsViewer("Ada", "ada")).toBe(true);
    expect(sessionKeyIsViewer("ada@acme.io", "ada")).toBe(false);
    expect(sessionKeyIsViewer("adam", "ada")).toBe(false);
  });

  it("never guesses a null or blank key onto anyone, and nobody signed in matches nothing", () => {
    expect(sessionKeyIsViewer(null, "ada")).toBe(false);
    expect(sessionKeyIsViewer("  ", "ada")).toBe(false);
    expect(sessionKeyIsViewer("ada", null)).toBe(false);
    expect(sessionKeyIsViewer("", "")).toBe(false);
  });
});

describe("applyOwnSessionShape", () => {
  it("counts only the viewer's rows inside the 30-day window", () => {
    const view = fold("ada", [...rows("ada", 7), ...rows("ada", 4, 31), ...rows("grace", 20), ...rows(null, 5)]);
    expect(view.ownTelemetry?.sessions).toBe(7);
    expect(view.shape.sessionsPerWeek).toBe(1.6); // 7 / (30 / 7)
  });

  it("includes a session that started exactly at the window's start", () => {
    expect(careTelemetryWindowStart(NOW)).toEqual(at(30));
    expect(fold("ada", rows("ada", 5, 30)).ownTelemetry?.sessions).toBe(5);
  });

  it("leaves the view byte-identical to an unknown user's when none of the rows are the viewer's", () => {
    expect(fold("ada", [...rows("grace", 40), ...rows(null, 9)])).toEqual(emptyDeveloperView("ada"));
  });

  it("does nothing for an anonymous viewer, whatever rows it is handed", () => {
    expect(fold(null, rows(null, 12))).toEqual(emptyDeveloperView(null));
  });

  it("measures but does not rate below the sample floor, and names why", () => {
    const view = fold("ada", rows("ada", 4));
    expect(view.shape.sessionsPerWeek).toBeNull();
    expect(careShapeEmptyReason(view, "sessionsPerWeek")).toBe("few-own-sessions");
    expect(CARE_SHAPE_REASON_COPY["few-own-sessions"].label).toBe("too few sessions");
  });

  it("guard: a field the mentor shared wins over telemetry", () => {
    const view = emptyDeveloperView("ada");
    view.sharedFields = ["sessionsPerWeek"];
    view.shape.sessionsPerWeek = 9;
    applyOwnSessionShape(view, rows("ada", 20), NOW);
    expect(view.shape.sessionsPerWeek).toBe(9);
    expect(view.ownTelemetry).toBeNull();
  });
});

// Operator decision 2026-09-24 (row 27 follow-up): a session also counts when its key is an email the
// auth provider CONFIRMED for the viewer. The comparison is case-insensitive on both keys.
describe("sessionKeyIsViewer with a confirmed email", () => {
  it("matches the confirmed email, case-insensitively, as well as the login", () => {
    expect(sessionKeyIsViewer("ada@acme.io", "ada", "ada@acme.io")).toBe(true);
    expect(sessionKeyIsViewer("Ada@ACME.io", "ada", "ada@acme.io")).toBe(true);
    expect(sessionKeyIsViewer("ada", "ada", "ada@acme.io")).toBe(true);
  });

  it("never matches another person's email or a look-alike", () => {
    expect(sessionKeyIsViewer("grace@acme.io", "ada", "ada@acme.io")).toBe(false);
    expect(sessionKeyIsViewer("ada@acme.io.evil", "ada", "ada@acme.io")).toBe(false);
    expect(sessionKeyIsViewer("xada@acme.io", "ada", "ada@acme.io")).toBe(false);
  });

  it("an unconfirmed email (passed as null) adds nothing, and an email alone is no viewer", () => {
    expect(sessionKeyIsViewer("ada@acme.io", "ada", null)).toBe(false);
    expect(sessionKeyIsViewer("ada@acme.io", null, "ada@acme.io")).toBe(false);
    expect(sessionKeyIsViewer("", "ada", "")).toBe(false);
  });
});

describe("ownSessionKeys", () => {
  it("lists the login and the confirmed email, each as resolved and lower-cased, without duplicates", () => {
    expect(ownSessionKeys("Ada", "Ada@Acme.io")).toEqual(["Ada", "ada", "Ada@Acme.io", "ada@acme.io"]);
    expect(ownSessionKeys("ada", "ada@acme.io")).toEqual(["ada", "ada@acme.io"]);
    expect(ownSessionKeys("ada@acme.io", "ada@acme.io")).toEqual(["ada@acme.io"]);
  });

  it("is empty with no login, whatever email it is handed", () => {
    expect(ownSessionKeys("  ", "ada@acme.io")).toEqual([]);
    expect(ownSessionKeys(null, "ada@acme.io")).toEqual([]);
    expect(ownSessionKeys("ada", null)).toEqual(["ada"]);
  });
});

describe("applyOwnSessionShape with a confirmed email", () => {
  it("counts rows under the login and rows under the confirmed email together", () => {
    const view = emptyDeveloperView("ada");
    applyOwnSessionShape(view, [...rows("ada", 2), ...rows("ADA@acme.io", 5), ...rows("grace@acme.io", 9)], NOW, "ada@acme.io");
    expect(view.ownTelemetry?.sessions).toBe(7);
  });

  it("without a confirmed email, rows under the viewer's address stay uncounted", () => {
    const view = emptyDeveloperView("ada");
    applyOwnSessionShape(view, rows("ada@acme.io", 9), NOW, null);
    expect(view).toEqual(emptyDeveloperView("ada"));
  });

  it("guard: a field the mentor shared still wins when the email matched", () => {
    const view = emptyDeveloperView("ada");
    view.sharedFields = ["sessionsPerWeek"];
    view.shape.sessionsPerWeek = 9;
    applyOwnSessionShape(view, rows("ada@acme.io", 20), NOW, "ada@acme.io");
    expect(view.shape.sessionsPerWeek).toBe(9);
    expect(view.ownTelemetry).toBeNull();
  });
});
