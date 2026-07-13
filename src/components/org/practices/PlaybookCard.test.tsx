// @vitest-environment jsdom
//
// Pins playbooks #7: a long unbroken playbook title wraps (break-words) within its min-w-0 flex item
// instead of overflowing the card. The title sits inline with the dim badge, so it wraps rather than
// truncating (keeping it fully visible).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaybookCard } from "./PlaybookCard";
import type { PlaybookRow } from "@/lib/db";

function playbook(over: Partial<PlaybookRow> = {}): PlaybookRow {
  return {
    id: "p1",
    title: "Adopt CI",
    dimId: "D1",
    summary: "",
    steps: [],
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    version: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("PlaybookCard", () => {
  it("#7: wraps a long title within a min-w-0 break-words container", () => {
    const long = "P".repeat(200);
    render(
      <PlaybookCard
        playbook={playbook({ title: long })}
        slug="acme"
        dimLabel="Testing"
        adoption={undefined}
        repoOptions={[]}
        onRemove={() => {}}
      />,
    );
    const container = screen.getByText(long).parentElement!;
    expect(container).toHaveClass("min-w-0");
    expect(container).toHaveClass("break-words");
  });
});
