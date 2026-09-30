// @vitest-environment jsdom

// The Prism policy editor keeps the Altimeter hook. These tests pin the kit controls: accessible
// names, the D9 split, and that an added floor is what gets posted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GatePolicyEditorV2 } from "./GatePolicyEditor.v2";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function stubSave(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("GatePolicyEditorV2", () => {
  it("seeds the kit controls and posts an added floor, not a removed one", async () => {
    const fetchMock = stubSave({
      policy: { minLevel: "L3", minDimensionFor: { D3: 50, D9: 70 } },
      sweep: { status: "scheduled", repos: 1, cap: 20 },
    });
    render(<GatePolicyEditorV2 org="acme" initial={{ minLevel: "L3", minDimensionFor: { D2: 45, D9: 70 } }} />);

    expect((screen.getByRole("combobox", { name: "Minimum level" }) as HTMLSelectElement).value).toBe("L3");
    expect((screen.getByRole("spinbutton", { name: /^D2 .* minimum score$/ }) as HTMLInputElement).value).toBe("45");
    expect(screen.queryByRole("spinbutton", { name: /^D9 .* minimum score$/ })).toBeNull();
    expect((screen.getByRole("spinbutton", { name: "Security floor (D9 minimum)" }) as HTMLInputElement).value).toBe("70");
    expect((screen.getByRole("checkbox", { name: "Enable security floor" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "Add a floor" }), { target: { value: "D3" } });
    expect((screen.getByRole("spinbutton", { name: /^D3 .* minimum score$/ }) as HTMLInputElement).value).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: /Remove the D2 .* floor/ }));
    expect(screen.queryByRole("spinbutton", { name: /^D2 .* minimum score$/ })).toBeNull();

    const rate = screen.getByRole("spinbutton", { name: "Minimum AI-governed rate" }) as HTMLInputElement;
    expect(rate.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /AI-governed/i }));
    expect(rate.disabled).toBe(false);

    fireEvent.change(screen.getByRole("textbox", { name: "Doctor check id" }), { target: { value: "control.prepush.lint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add required control" }));
    expect(screen.getByText("control.prepush.lint")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove required control control.prepush.lint" }));
    expect(screen.queryByText("control.prepush.lint")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      policy: { minLevel: string; minDimensionFor: Record<string, number> };
    };
    expect(sent.policy.minLevel).toBe("L3");
    expect(sent.policy.minDimensionFor.D3).toBe(50);
    expect(sent.policy.minDimensionFor.D2).toBeUndefined();
    expect(sent.policy.minDimensionFor.D9).toBe(70);
  });
});
