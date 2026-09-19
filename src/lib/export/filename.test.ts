// Unit tests for the shared Content-Disposition filename sanitizers. These pin the two distinct
// contracts the download routes rely on: a case-PRESERVING segment cleaner (PDF/skill/passport/
// briefing) and a lower-cased slug cleaner (CSV/JSON exports). The security-relevant invariant for
// both is that no header-breaking byte (`"`, CR/LF, `;`, `/`) can survive.

import { describe, it, expect } from "vitest";
import { safeFilenameSegment, safeFilenameSlug } from "./filename";

describe("safeFilenameSegment (case-preserving)", () => {
  it("preserves case, dots, underscores and dashes verbatim", () => {
    expect(safeFilenameSegment("MyOrg_Repo-Name.v2")).toBe("MyOrg_Repo-Name.v2");
  });

  it("replaces every non-[A-Za-z0-9._-] byte with a dash", () => {
    expect(safeFilenameSegment("a b/c")).toBe("a-b-c");
    expect(safeFilenameSegment("owner/name")).toBe("owner-name");
  });

  it("strips header-breaking and formula bytes (quote, CRLF, semicolon, equals)", () => {
    expect(safeFilenameSegment('a"b')).toBe("a-b");
    expect(safeFilenameSegment("a\r\nSet-Cookie: x")).toBe("a--Set-Cookie--x");
    expect(safeFilenameSegment("a;b")).toBe("a-b");
    expect(safeFilenameSegment("=cmd|'/c calc'")).toBe("-cmd---c-calc-");
    expect(safeFilenameSegment("日本")).toBe("--");
  });
});

describe("safeFilenameSlug (lower-cased)", () => {
  it("lower-cases and collapses runs of unsafe bytes to a single dash", () => {
    expect(safeFilenameSlug("My Org / Repo")).toBe("my-org-repo");
    expect(safeFilenameSlug("Acme")).toBe("acme");
  });

  it("trims leading and trailing dashes", () => {
    expect(safeFilenameSlug("  spaced  ")).toBe("spaced");
    expect(safeFilenameSlug("---x---")).toBe("x");
  });

  it("falls back to the supplied fallback when the slug reduces to empty", () => {
    expect(safeFilenameSlug("日本")).toBe("export"); // default fallback
    expect(safeFilenameSlug("   ", "org")).toBe("org");
    expect(safeFilenameSlug("///", "repo")).toBe("repo");
  });

  it("strips formula/CRLF/quote bytes so nothing survives into a header", () => {
    expect(safeFilenameSlug('a"b')).toBe("a-b");
    expect(safeFilenameSlug("a\r\nSet-Cookie: x=1")).toBe("a-set-cookie-x-1");
    expect(safeFilenameSlug('"; attachment; filename="evil')).toBe("attachment-filename-evil");
    expect(safeFilenameSlug("=1+2")).toBe("1-2");
  });

  it("caps at the default 80 chars", () => {
    expect(safeFilenameSlug("a".repeat(200))).toHaveLength(80);
  });

  it("honors a custom maxLen (the usage route's 64-char cap)", () => {
    expect(safeFilenameSlug("a".repeat(200), "org", 64)).toHaveLength(64);
  });
});
