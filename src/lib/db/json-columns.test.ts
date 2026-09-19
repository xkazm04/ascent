import { expect, it } from "vitest";
import { parseStringArray } from "./json-columns";

it.each([null, undefined, "", "{broken", "null", "true", "42", '"text"', "{}"])(
  "returns null for unread JSON-in-TEXT %j (not a measured empty list)",
  (raw) => {
    expect(parseStringArray(raw)).toBeNull();
  },
);

it("keeps JSON [] as a measured empty list", () => {
  expect(parseStringArray("[]")).toEqual([]);
  expect(parseStringArray("[]")).not.toBeNull();
});

it("an array of only non-strings is measured-empty after dropping, not unread", () => {
  expect(parseStringArray("[1,null,false,{}]")).toEqual([]);
});

it("preserves string values, order and duplicates without coercing other JSON values", () => {
  expect(parseStringArray('["z",null,3,"",false,{"a":1},["nested"],"z","  a  ","caf\u00e9"]')).toEqual([
    "z",
    "",
    "z",
    "  a  ",
    "caf\u00e9",
  ]);
});
