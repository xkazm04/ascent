// @vitest-environment jsdom
//
// Skills Uses is all-time volume across sink A and sink B. The neighbouring Registry tab labels its
// readouts "invokes 30d". The column header must name sinks and window so those two numbers cannot
// be read as the same rate.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SkillsLibraryTable,
  USES_COLUMN_TITLE,
  USES_COLUMN_WINDOW,
  USES_TABLE_CAPTION,
} from "./SkillsLibraryTable";
import type { SkillRow } from "@/lib/db";

function skill(): SkillRow {
  return {
    id: "s1",
    name: "pr-review",
    description: "",
    content: "",
    category: "workflow",
    tags: [],
    frontmatter: {} as SkillRow["frontmatter"],
    version: 1,
    contentHash: "",
    downloadCount: 4,
    adoptionCount: 1,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

function renderTable() {
  return render(
    <SkillsLibraryTable
      slug="acme"
      skills={[skill()]}
      loading={false}
      filtered={false}
      expanded={null}
      setExpanded={() => {}}
      adoption={{}}
      usage={{}}
      outcomes={{}}
      repoOptions={["acme/app"]}
      isAdmin={false}
      archive={() => {}}
      registryBase={null}
    />,
  );
}

describe("SkillsLibraryTable — Uses column", () => {
  it("names sinks and the all-time window, distinct from the Registry 30d rate", () => {
    renderTable();
    const uses = screen.getByRole("columnheader", { name: /Uses/ });
    expect(uses).toHaveAttribute("data-uses-window", USES_COLUMN_WINDOW);
    expect(uses).toHaveAttribute("data-uses-sinks", "A B");
    expect(uses).toHaveAttribute("title", USES_COLUMN_TITLE);
    expect(uses.textContent).toMatch(/Uses/);
    expect(uses.textContent).toMatch(/all-time/);
    expect(uses.textContent).not.toMatch(/30d/);
    expect(USES_COLUMN_WINDOW).toBe("all-time");
    expect(USES_COLUMN_TITLE).toMatch(/sink A/i);
    expect(USES_COLUMN_TITLE).toMatch(/sink B/i);
    expect(USES_COLUMN_TITLE).toMatch(/all-time/i);
    expect(USES_COLUMN_TITLE).toMatch(/Distinct from the Registry tab's 30d invoke rate/);
    expect(screen.getByText(USES_TABLE_CAPTION)).toBeTruthy();
    expect(USES_TABLE_CAPTION).toMatch(/all-time uses/);
    expect(USES_TABLE_CAPTION).toMatch(/sink A/);
    expect(USES_TABLE_CAPTION).toMatch(/sink B/);
    expect(USES_TABLE_CAPTION).toMatch(/not the Registry 30d rate/);
  });
});
