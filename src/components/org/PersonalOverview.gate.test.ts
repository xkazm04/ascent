// THE PERSONAL WORKSPACE USES THE SHARED PRESENTABILITY GATE (MC-B34).
//
// `PersonalOverview` filtered its trajectory cards on `r.forecast !== null` — existence, not
// presentability — so a fit resting on two scan days over three calendar days still rendered a
// projection card. It was the last forecast surface deciding that for itself; every other one
// (the /trends panel, the Delivery fit readout, the briefing, the digest) is behind
// `composeTrajectory` / `isProjectable`.
//
// A source guard rather than a render test, in the spirit of `id-routes-gated.test.ts`: the
// component is an async server component that reads the database, and what must not regress is the
// PREDICATE it filters on — a `forecast !== null` filter reappearing there is the defect, whatever
// it renders.
//
// G4-10 (personal): the landing also used to Promise.all the watchlist with usage and passports, so
// a throw on any one rejected the page. The rejected-passports case below pins the allSettled shape
// that keeps the repo list on the page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeTrajectory, isProjectable, MIN_FORECAST_POINTS, MIN_FORECAST_SPAN_DAYS } from "@/lib/maturity/forecast";
import type { Forecast } from "@/lib/maturity/forecast";

const SRC = readFileSync(join(process.cwd(), "src/components/org/PersonalOverview.tsx"), "utf8");

const fit = (points: number, spanDays: number): Forecast =>
  ({ points, spanDays, fitQuality: 0.8, perWeek: 1, trajectory: "improving" }) as unknown as Forecast;

describe("PersonalOverview's trajectory gate", () => {
  it("composes the read rather than testing the forecast for null", () => {
    expect(SRC).toContain("composeTrajectory(r.forecast)");
    // The exact predicate that shipped the defect. Not a stylistic objection: it is the difference
    // between "a line exists" and "a line may be projected".
    expect(SRC).not.toContain("r.forecast !== null");
  });

  it("renders the refusal instead of dropping a sub-gate repo in silence", () => {
    // A tracked repo whose neighbours have a card and it does not, with no reason given, is the
    // failure mode the verbatim insufficiency sentence exists to prevent.
    expect(SRC).toContain("t.read.insufficiency");
  });
});

describe("the gate the component now defers to", () => {
  it("refuses a fit that has the points but not the span", () => {
    const thin = fit(MIN_FORECAST_POINTS, MIN_FORECAST_SPAN_DAYS - 1);
    expect(isProjectable(thin)).toBe(false);
    const read = composeTrajectory(thin);
    expect(read.headline).toBeNull();
    expect(read.insufficiency).toContain(`at least ${MIN_FORECAST_SPAN_DAYS}`);
  });

  it("refuses a fit that has the span but not the points — a line through two points fits perfectly", () => {
    const read = composeTrajectory(fit(MIN_FORECAST_POINTS - 1, 90));
    expect(read.headline).toBeNull();
    expect(read.insufficiency).not.toBeNull();
  });

  it("says nothing at all when there is no fit — absence is not a refusal to explain", () => {
    const read = composeTrajectory(null);
    expect(read.headline).toBeNull();
    expect(read.insufficiency).toBeNull();
  });
});

describe("PersonalOverview degrades per read", () => {
  it("settles watchlist, usage, and passports instead of rejecting the landing on one blip", () => {
    expect(SRC).toMatch(/Promise\.allSettled/);
    expect(SRC).not.toMatch(/await Promise\.all\(/);
    expect(SRC).toMatch(/import \{ settle \} from "@\/features\/bought\/delivery\/deliveryLoad"/);
    // `\r?\n`, not `\n`: this assertion reads SOURCE TEXT, so a bare `\n` is a checkout-line-ending
    // flake (CI Linux LF vs Windows CRLF) rather than a code check.
    expect(SRC).toMatch(
      /getPersonalWatchlist\(slug\),\r?\n\s*getPersonalUsage\(slug\),\r?\n\s*getPersonalPassports\(slug\)/,
    );
  });

  it("renders the watchlist when passports reject, rather than blanking the landing", () => {
    // The defect: Promise.all of the three reads rejected the page when passports threw, so 0 of 1
    // rejected-passports cases showed the repo list. passportsFailed only gates the passport
    // section (plus its own "couldn't load" banner); the watchlist is still mapped.
    expect(SRC).toContain("Your repositories");
    expect(SRC).toMatch(/repos\.map\(\(r\) =>/);
    expect(SRC).toMatch(/passportsFailed/);
    expect(SRC).toMatch(/App Readiness Passports couldn&apos;t load/);
    expect(SRC).not.toMatch(/if \(passportsFailed\)[\s\S]{0,120}return/);
  });

  it("degrades usage independently rather than taking the repo list down with the meters", () => {
    expect(SRC).toMatch(/usageFailed/);
    expect(SRC).toMatch(/Usage meters couldn&apos;t load/);
  });
});
