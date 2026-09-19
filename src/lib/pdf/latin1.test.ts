import { describe, expect, it } from "vitest";
import { latin1Safe } from "./latin1";

describe("latin1Safe — keep Helvetica-renderable glyphs, flag the rest", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(latin1Safe("owner/repo-name_1.2")).toBe("owner/repo-name_1.2");
  });

  it("keeps Latin-1 accented letters (they ARE representable) as-is", () => {
    expect(latin1Safe("Résumé café ñ über àçÿ")).toBe("Résumé café ñ über àçÿ");
  });

  it("keeps the CP1252 punctuation Helvetica supports (dashes, curly quotes, ellipsis, €, ™)", () => {
    const s = "A – B — “q” ‘x’ … • € ™";
    expect(latin1Safe(s)).toBe(s);
  });

  it("replaces truly un-representable characters with a VISIBLE placeholder, not a silent drop", () => {
    // Latin-Extended (ł, ő, ș), Cyrillic, CJK, emoji all sit above U+00FF and are dropped by Helvetica.
    expect(latin1Safe("Paweł")).toBe("Pawe?");
    expect(latin1Safe("Győr")).toBe("Gy?r");
    expect(latin1Safe("Владимир")).toBe("????????");
    expect(latin1Safe("東京")).toBe("??");
    expect(latin1Safe("ok✅")).toBe("ok?"); // emoji is one placeholder, not a split surrogate
  });

  it("is a no-op on the empty string", () => {
    expect(latin1Safe("")).toBe("");
  });
});
