import { describe, expect, it } from "vitest";
import { boundedFetchedFile } from "./fetched-file";

describe("boundedFetchedFile", () => {
  it.each([
    ["abcdef", 3, "abc"],
    ["éclair", 1, ""],
    ["éclair", 2, "é"],
    ["界面", 5, "界"],
    ["😀tail", 3, ""],
    ["😀tail", 4, "😀"],
    ["a😀b", 4, "a"],
    ["a😀b", 5, "a😀"],
    ["text", 0, ""],
    ["", 14_000, ""],
    ["small", 14_000, "small"],
  ])("caps %j at %i bytes without replacement characters", (content, cap, expected) => {
    const result = boundedFetchedFile("README.md", content, cap);
    expect(result).toEqual({ path: "README.md", content: expected, bytes: Buffer.byteLength(content, "utf8") });
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(cap);
  });
});
