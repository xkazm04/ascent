import { describe, expect, it } from "vitest";
import { missionControlHref, type Installation } from "./FleetMap.constants";

const fleet = (logins: string[]): Installation[] =>
  logins.map((login, i) => ({ id: i + 1, login }));

describe("missionControlHref — Enter mission control destination", () => {
  it("sends the /onboarding default to the first org dashboard when the viewer has a fleet", () => {
    expect(missionControlHref("/onboarding", fleet(["acme", "globex"]))).toBe("/org/acme");
  });

  it("lets an explicit safe next win", () => {
    expect(missionControlHref("/org/globex", fleet(["acme"]))).toBe("/org/globex");
    expect(missionControlHref("/report/acme/api", fleet(["acme"]))).toBe("/report/acme/api");
  });

  it("keeps /onboarding when there is no installation to enter", () => {
    expect(missionControlHref("/onboarding", [])).toBe("/onboarding");
  });
});
