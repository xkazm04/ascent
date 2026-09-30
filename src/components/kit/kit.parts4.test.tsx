import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CellMark, FormField, Input, Ladder, ListRow } from "./index";

describe("kit parts 4", () => {
  it("FormField ties the label to the control and shows an error as a word with a glyph", () => {
    const out = renderToStaticMarkup(
      <FormField label="Repo" htmlFor="r" hint="owner/name" error="Required">
        <Input id="r" />
      </FormField>,
    );
    expect(out).toContain('for="r"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("Required");
    expect(out).not.toContain("owner/name");
    expect(out).toContain('data-kit="field-control"');
  });

  it("ListRow renders a button when pressable and marks the selected row", () => {
    const out = renderToStaticMarkup(
      <ul>
        <ListRow title="A" onPress={() => {}} selected />
      </ul>,
    );
    expect(out).toContain("<button");
    expect(out).toContain('aria-current="true"');
    expect(out).toContain("data-selected");
  });

  it("Ladder says each state in words and marks the current step", () => {
    const out = renderToStaticMarkup(
      <Ladder
        label="Tiers"
        steps={[
          { key: "a", label: "T0", state: "reached" },
          { key: "b", label: "T1", state: "current" },
          { key: "c", label: "T2", state: "unmeasured" },
        ]}
      />,
    );
    expect(out).toContain("reached");
    expect(out).toContain('aria-current="step"');
    expect(out).toContain("not measured");
  });

  it("CellMark never leaves a state as colour alone", () => {
    for (const s of ["met", "partial", "missing", "unmeasured"] as const) {
      const out = renderToStaticMarkup(<CellMark state={s} />);
      expect(out).toContain('data-role="cell-glyph"');
      expect(out).toContain('data-role="cell-word"');
    }
  });
});
