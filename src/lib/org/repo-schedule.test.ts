import { describe, it, expect } from "vitest";
import { PUSH_RESCAN_DISCLOSURE } from "./repo-schedule";

describe("PUSH_RESCAN_DISCLOSURE", () => {
  it("says an org with its own model key is not charged for push rescans", () => {
    expect(PUSH_RESCAN_DISCLOSURE).toContain("An org that brings its own model key is not charged for push rescans.");
  });

  it("keeps the phrases the schedule select tests match", () => {
    expect(PUSH_RESCAN_DISCLOSURE).toContain("default branch is pushed");
    expect(PUSH_RESCAN_DISCLOSURE).toContain('"no autoscan" stops push rescans too');
  });
});
