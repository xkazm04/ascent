// Type scale for the war-room headline strip.
//
// DECISION (G6-01): the wall is a distinct MODE, not a responsive tier.
//
// A breakpoint keys off viewport width, and viewport width does not encode viewing distance: a
// 1920×1080 TV read by a room from 4 metres and a maximised 1920px laptop window read by one person
// from 60cm are the SAME CSS viewport. Adding a `2xl:` step to the hero numbers would therefore blow
// up the laptop dashboard while still being keyed to the wrong variable, and would still under-serve
// a 1366×768 projector — the most common conference-room output — which never reaches `2xl` at all.
//
// The app already carries an explicit declaration of intent for "this is on a wall": TV mode
// (fullscreen + screen wake lock) and the signed read-only share link, whose stated purpose is to
// "show this wall on an unauthenticated screen". Scale keys off THAT. Within each mode the ordinary
// breakpoints still do their ordinary job, so a wall at 4K gets a bigger step than a wall at 720p.
//
// Sizing basis: at 4m a 55" 1080p panel renders 1px ≈ 0.63mm. The `panel` tier's 14px labels are
// ≈8.8mm ≈ 7.6 arcmin — at the acuity floor, which is why "just bump the font size on the numbers"
// is the wrong remedy: the LABELS and the delta/sub captions fail before the numerals do. The `wall`
// tier lifts every text role, not only the hero figure, and keeps the hero ≥48px at every breakpoint
// (the dataviz hero-figure floor).

export type WallScale = "panel" | "wall";

export interface HeadlineScaleTokens {
  /** Cell padding. */
  pad: string;
  /** Uppercase metric label above the value. */
  label: string;
  /** The hero numeral. */
  value: string;
  /** CVD-safe score glyph beside the numeral. */
  glyph: string;
  /** Signed "since kickoff" movement chip. */
  delta: string;
  /** Muted context line under the value. */
  sub: string;
  /** Sparkline box, in px. */
  spark: { w: number; h: number };
}

export const HEADLINE_SCALE: Record<WallScale, HeadlineScaleTokens> = {
  panel: {
    pad: "p-4 lg:p-5",
    label: "text-sm",
    value: "text-3xl sm:text-4xl",
    glyph: "text-base",
    delta: "text-sm",
    sub: "text-sm",
    spark: { w: 112, h: 28 },
  },
  wall: {
    pad: "p-6 xl:p-8",
    label: "text-base xl:text-xl",
    value: "text-5xl sm:text-6xl xl:text-7xl",
    glyph: "text-2xl xl:text-4xl",
    delta: "text-base xl:text-lg",
    sub: "text-base xl:text-lg",
    spark: { w: 176, h: 44 },
  },
};
