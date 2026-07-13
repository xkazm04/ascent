// Pins the number-formatting contract of the canonical Stat block (src/components/ui/Stat.tsx): a raw
// numeric `value` is thousands-grouped with `.toLocaleString()` so a large fleet count reads
// "4,823,019" not "4823019" (matching every other `.toLocaleString()` call site), while already-
// formatted strings pass through untouched and `raw` opts a number out of grouping. Stat owns no hooks,
// so — like EmptyState.test.tsx — we invoke the component function directly and walk the returned tree.

import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Stat } from "./Stat";

type El = ReactElement<{ className?: string; children?: ReactNode }>;

function flatten(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as El;
  out.push(el);
  flatten(el.props?.children, out);
  return out;
}

function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node as El).props?.children);
  return "";
}

/** The bold value block — the div carrying the tabular-nums headline class. */
function valueText(props: Parameters<typeof Stat>[0]): string {
  const els = flatten(Stat(props));
  const valueDiv = els.find((el) => (el.props.className ?? "").includes("text-2xl"));
  expect(valueDiv).toBeDefined();
  return textOf(valueDiv!);
}

describe("Stat — numeric value formatting", () => {
  it("thousands-groups a large numeric value", () => {
    expect(valueText({ label: "Impressions", value: 4823019 })).toBe((4823019).toLocaleString());
  });

  it("leaves a sub-thousand number (a 0–100 score) unchanged", () => {
    expect(valueText({ label: "Overall", value: 87 })).toBe("87");
  });

  it("groups a four-digit count (1000 → localized) rather than showing bare digits", () => {
    expect(valueText({ label: "Scans", value: 1000 })).toBe((1000).toLocaleString());
  });

  it("passes an already-formatted string value through untouched", () => {
    expect(valueText({ label: "Percentile", value: "—" })).toBe("—");
    expect(valueText({ label: "Rate", value: "42%" })).toBe("42%");
  });

  it("raw opts a number out of grouping (exact digits for a year/id)", () => {
    expect(valueText({ label: "Year", value: 2026, raw: true })).toBe("2026");
  });
});
