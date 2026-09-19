// The PDF documents render with @react-pdf/renderer's BUILT-IN Helvetica (no font registration), which
// can only draw the WinAnsi / CP1252 glyph set: Latin-1 (U+0000–U+00FF) plus a fixed handful of "smart"
// punctuation. Any other code point — CJK, Cyrillic, Latin-Extended letters like ł / ő / ș, most emoji —
// is SILENTLY DROPPED from the output, so a repo owner "Paweł" would export as "Pawe" and a reviewer
// would never know a character went missing.
//
// Registering a full Unicode font would fix rendering but means shipping (and lazily loading) a ~hundreds-
// -of-KB TTF into a server route, plus a hard dependency on that asset existing at runtime. The smaller,
// safe fix is to make the loss VISIBLE: replace each un-representable character with "?" so a mangled
// name reads as an obvious gap ("Pawe?") rather than a plausible-but-wrong string. Latin-1 accented
// letters (à, é, ñ, ü, …) and the CP1252 punctuation Helvetica DOES support (– — “ ” ‘ ’ … • € ™) are
// representable and kept as-is, so this never regresses currently-correct output.

// The CP1252 "extra" code points (the C1 region 0x80–0x9F remapped to real glyphs) that WinAnsi renders.
const CP1252_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Replace every character the built-in PDF Helvetica can't render with a visible "?" placeholder. */
export function latin1Safe(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    out += cp <= 0xff || CP1252_EXTRA.has(cp) ? ch : "?";
  }
  return out;
}
