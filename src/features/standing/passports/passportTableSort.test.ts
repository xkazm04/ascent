// Backlog develop-2026-09-17 row 28: a HELD CI/security rung (workflow files not read in full) is not
// ranked. Sorting it by its floor (`build`, `none`) filed a coverage hole among the weakest pipelines;
// it now sorts after every assessed row in either direction.

import { describe, it, expect } from "vitest";
import { compareRows, type SortableRow } from "./passportTableSort";

const HELD = [
  { id: "prod.ci-unassessable", code: "ci-unassessable" },
  { id: "prod.security-unassessable", code: "security-unassessable" },
];
const row = (name: string, ci: string, security: string, held = false): SortableRow => ({
  name, autoScore: 50, prodScore: 50, ci, tests: "none", security, observability: "none",
  detail: { prodFindings: held ? HELD : [] },
});
const ROWS = [row("gated", "gated", "scanning"), row("held", "build", "none", true), row("none", "none", "none"), row("build", "build", "none")];
const order = (key: "ci" | "security", dir: "asc" | "desc") => [...ROWS].sort((a, b) => compareRows(a, b, key, dir)).map((r) => r.name);

describe("compareRows: a held rung is not ranked", () => {
  it("sorts a held CI row after every assessed row, ascending and descending", () => {
    expect(order("ci", "desc")).toEqual(["gated", "build", "none", "held"]);
    expect(order("ci", "asc")).toEqual(["none", "build", "gated", "held"]);
  });

  it("does the same on the security column", () => {
    expect(order("security", "desc").at(-1)).toBe("held");
    expect(order("security", "asc").at(-1)).toBe("held");
  });

  it("guard: rows with no held rung keep the ladder order", () => {
    const plain = ROWS.filter((r) => r.name !== "held");
    expect([...plain].sort((a, b) => compareRows(a, b, "prodScore", "desc")).length).toBe(3);
    expect([...plain].sort((a, b) => compareRows(a, b, "ci", "desc")).map((r) => r.name)).toEqual(["gated", "build", "none"]);
  });
});
