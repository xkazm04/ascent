// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LEVEL_HEX } from "@/lib/ui";
import { AppearanceStudy } from "./AppearanceStudy";

describe("AppearanceStudy design-tokens", () => {
  it("renders the live token table and no Mint/Amber appearance labels", () => {
    render(<AppearanceStudy slug="design-tokens" />);
    expect(screen.queryByRole("button", { name: "Mint" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Amber" })).toBeNull();
    expect(screen.queryByLabelText("Mint")).toBeNull();
    expect(screen.queryByLabelText("Amber")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\bMint\b|\bAmber\b/);
    for (const token of ["accent", "ink", "surface", "divider", "danger", "warn", "success", "LEVEL_HEX"]) {
      expect(screen.getByText(token)).toBeTruthy();
    }
    for (const id of Object.keys(LEVEL_HEX)) {
      expect(screen.getByText(id)).toBeTruthy();
    }
  });
});
