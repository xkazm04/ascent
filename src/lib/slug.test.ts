import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("removes a separator left at the length cap", () => {
    expect(slugify("hello world foo", 12)).toBe("hello-world");
    expect(slugify("--", 1, "playbook")).toBe("playbook");
  });
});
