import { expect, it } from "vitest";
import { parseStringArray } from "./json-columns";

it.each([null, undefined, "", "{broken", "null", "true", "42", '"text"', "{}", "[]"])(
  "keeps the optional-list compatibility fallback for %j", (raw) => {
    expect(parseStringArray(raw)).toEqual([]);
  },
);
it("preserves string values, order and duplicates without coercing other JSON values", () => {
  expect(parseStringArray('["z",null,3,"",false,{"a":1},["nested"],"z","  a  ","caf\u00e9"]'))
    .toEqual(["z", "", "z", "  a  ", "caf\u00e9"]);
});
