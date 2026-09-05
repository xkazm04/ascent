import { describe, expect, it } from "vitest";
import {
  parseProjectionHeader,
  projectionBody,
  projectionState,
  renderProjection,
  sha12,
} from "@/lib/analyze/guidance-projection";

const CANON = "# Repo guidance\n\n- Test: `npm test`\n- Never commit secrets.\n";

describe("projection header round-trip", () => {
  it("parses back exactly what it rendered", () => {
    const text = renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON });
    const h = parseProjectionHeader(text);
    expect(h).not.toBeNull();
    expect(h!.sourcePath).toBe("AGENTS.md");
    expect(h!.sourceHash).toBe(sha12(CANON));
    expect(projectionBody(text)).toBe(CANON);
  });

  it("is idempotent — a second render over an unchanged source is byte-identical", () => {
    expect(renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON })).toBe(
      renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON }),
    );
  });

  it("keeps Cursor front matter ahead of the header and out of the body hash", () => {
    const text = renderProjection({
      sourcePath: "AGENTS.md",
      sourceBody: CANON,
      frontMatter: "---\nalwaysApply: true\n---",
    });
    expect(text.startsWith("---\n")).toBe(true);
    expect(projectionBody(text)).toBe(CANON);
    expect(projectionState(text, CANON).state).toBe("in-sync");
  });

  it("returns null for a document that is not a projection", () => {
    expect(parseProjectionHeader(CANON)).toBeNull();
    expect(projectionState(CANON, CANON).state).toBe("not-a-projection");
  });
});

describe("drift classification", () => {
  it("a hand-edited body changes the body hash — reported as hand-edited, not stale", () => {
    const text = renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON });
    const edited = text.replace("npm test", "npm run test:ci");
    expect(projectionState(edited, CANON).state).toBe("hand-edited");
  });

  it("a canonical edit changes the source hash — reported as stale", () => {
    const text = renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON });
    expect(projectionState(text, CANON + "\n- Build: `npm run build`\n").state).toBe("stale");
  });

  it("an unsampled canonical leaves the state at in-sync rather than guessing stale", () => {
    const text = renderProjection({ sourcePath: "AGENTS.md", sourceBody: CANON });
    expect(projectionState(text, null).state).toBe("in-sync");
  });
});
