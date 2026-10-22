// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MODAL_ROOT_ID } from "@/components/ui/ModalRoot";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ScanForm", () => ({ ScanForm: () => <div>Scan form</div> }));
vi.mock("@/components/QuotaMeter", () => ({ QuotaMeter: () => null }));

import { ScanModal } from "./ScanModal";

describe("ScanModal shared dialog", () => {
  it("opens in the modal portal and closes with Escape", async () => {
    const host = document.createElement("div");
    host.id = MODAL_ROOT_ID;
    document.body.append(host);
    try {
      render(<ScanModal auth={null} />);
      const trigger = screen.getByRole("button", { name: /scan a repository/i });
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog", { name: "Scan a repository" });
      expect(host.contains(dialog)).toBe(true);
      expect(screen.getByText("Scan form")).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      host.remove();
    }
  });
});
